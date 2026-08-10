//! Atomic turn and stored-replacement orchestration.

use er_content::pack::ContentPack;
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_state::battle::{
    BattleOutcome, BattleState, CommandCollectionState, FaintOccurrence, ReplacementProgress,
};
use er_state::digest::compute_mechanical_state_digest;
use er_state::pokemon::PokemonState;
use er_state::snapshot::GameState;
use er_types::battle_command::{
    CommandSet, ReplacementSelection, validate_turn_result_operation_id,
};
use er_types::battle_ids::{AuthorityEpoch, BattleSide, FaintOccurrenceId, FieldSlot, PokemonId};
use er_types::battle_model::{ActionDisposition, BattleStat, ResolvedAction, ResolvedActionKind};
use er_types::{OperationId, SafeU53};

use crate::ability_pipeline::{
    DefensiveAbilityInput, DefensiveAbilityOutcome, evaluate_defensive_ability,
    evaluate_switch_in_ability,
};
use crate::action_order::{
    PendingAction, build_pending_action_queue_from_commands, effective_speed,
};
use crate::command::NormalizedBattleCommand;
use crate::error::{BattleInvariantError, BattleResolveError};
use crate::faint::{FaintCandidate, FaintQueueError, queue_faint};
use crate::legality::{CommandLegalityError, normalize_command_set, validate_state_content};
use crate::move_effect::{
    DefensiveAbilityBlockReason, DefensiveAbilityGate, DefensiveAbilityGateError,
    DefensiveAbilityGateInput, DefensiveAbilityGateResult, MoveTargetResult,
    TargetEffectDisposition,
};
use crate::move_pipeline::{MovePipelineDisposition, MovePipelineResult, resolve_move};
use crate::outcome::derive_battle_outcome;
use crate::replacement::{
    apply_selected_replacement, compute_replacement_progress, resolve_no_legal_replacement,
    resolve_not_required, stored_faint_source, validate_stored_replacement_operation,
};
use crate::resolver::{
    BattleMutation, BattleNextDecision, BattleReplacementTransition, BattleTransition,
};
use crate::stat_stage::set_stage;
use crate::status::{
    StatusApplicationOutcome, StatusResidualInput, StatusResidualOutcome, resolve_residual,
};
use crate::switch::resolve_switch;

/// Resolve one complete admitted turn as an atomic transition.
pub fn resolve_turn(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleTransition, BattleResolveError> {
    validate_state_content(before, content)?;
    if authority_epoch == AuthorityEpoch::ZERO {
        return Err(BattleResolveError::Faint(
            FaintQueueError::ZeroAuthorityEpoch,
        ));
    }
    let before_battle = active_battle(before)?;
    validate_turn_result_operation_id(
        material_operation_id,
        before_battle.battle_id,
        before_battle.wave,
        before_battle.turn,
    )
    .map_err(CommandLegalityError::Command)?;
    let before_digest = compute_mechanical_state_digest(before)?;
    let normalized = normalize_command_set(before, commands, content)?;
    let mut queue =
        build_pending_action_queue_from_commands(before, normalized.entries(), content)?;
    let mut after = before.clone();
    let mut runtime = RngRuntime::from_states(
        before.run_rng.clone(),
        Some(before_battle.battle_rng.clone()),
    )?;
    let gate = ContentDefensiveAbilityGate { content };
    let mut action_order = Vec::new();
    let mut mutations = Vec::new();
    let mut turn_occurrence = 0_u32;

    while let Some(action) = queue.pop_next(&after, &mut runtime)? {
        match &action.command {
            NormalizedBattleCommand::Switch { .. } => {
                resolve_switch_action(
                    &mut after,
                    &action,
                    content,
                    &mut action_order,
                    &mut mutations,
                )?;
            }
            NormalizedBattleCommand::Fight { .. } => {
                resolve_move_action(
                    &mut after,
                    &action,
                    content,
                    &gate,
                    &mut runtime,
                    authority_epoch,
                    &mut turn_occurrence,
                    &mut action_order,
                    &mut mutations,
                )?;
            }
        }
        {
            let battle = active_battle_mut(&mut after)?;
            drain_internal_faint_heads(battle, &mut mutations)?;
            update_outcome(battle, &mut mutations);
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
        )?;
        let battle = active_battle_mut(&mut after)?;
        drain_internal_faint_heads(battle, &mut mutations)?;
        update_outcome(battle, &mut mutations);
    }

    clear_command_collection(&mut after, &mut mutations)?;
    if active_battle(&after)?.outcome == BattleOutcome::Ongoing {
        advance_turn_boundary(&mut after, &mut runtime, &mut mutations)?;
    } else {
        sync_rng_state(&mut after, &runtime)?;
    }

    validate_after_state(&after, content)?;
    let after_digest = compute_mechanical_state_digest(&after)?;
    let battle = active_battle(&after)?;
    let outcome = battle.outcome;
    let next_decision = next_decision(battle, outcome);

    Ok(BattleTransition {
        before_state: before.clone(),
        after_state: after,
        before_digest,
        after_digest,
        accepted_commands: commands.clone(),
        action_order,
        mutations,
        presentation: Vec::new(),
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
    let before_digest = compute_mechanical_state_digest(before)?;
    let mut after = before.clone();

    let primary = {
        let battle = active_battle_mut(&mut after)?;
        let stored = stored_faint_source(battle, occurrence)?;
        validate_stored_replacement_operation(material_operation_id, battle.battle_id, stored)?;
        match selection {
            ReplacementSelection::Selected { .. } => {
                apply_selected_replacement(battle, occurrence, selection)?
            }
            ReplacementSelection::NoLegalReplacement => {
                resolve_no_legal_replacement(battle, occurrence)?
            }
        }
    };

    let mut mutations = primary.mutations.clone();
    {
        let battle = active_battle_mut(&mut after)?;
        drain_internal_faint_heads(battle, &mut mutations)?;
        update_outcome(battle, &mut mutations);
    }

    validate_after_state(&after, content)?;
    let after_digest = compute_mechanical_state_digest(&after)?;
    let battle = active_battle(&after)?;
    let outcome = battle.outcome;
    let next_decision = next_decision(battle, outcome);

    Ok(BattleReplacementTransition {
        before_state: before.clone(),
        after_state: after,
        before_digest,
        after_digest,
        occurrence: primary.occurrence,
        selection: primary.selection,
        mutations,
        presentation: Vec::new(),
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
        .map_err(|_| DefensiveAbilityGateError::InvalidContext)?;

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
) -> Result<(), BattleResolveError> {
    let resolution = {
        let battle = active_battle_mut(state)?;
        resolve_switch(battle, &action.command, |updated, evidence| {
            evaluate_switch_in_ability(updated, evidence.slot, content)
        })?
    };
    let ability_outcome = resolution.post_switch?;

    push_pending_action(action_order, action, ActionDisposition::Executed)?;
    mutations.push(resolution.mutation);
    for change in ability_outcome.mutations() {
        let target = find_pokemon_mut(state, change.target_slot, change.target)?;
        set_stage(
            &mut target.stat_stages,
            BattleStat::Attack,
            change.mutation.after,
        );
        mutations.push(BattleMutation::StatStageChanged {
            pokemon: change.target,
            stat: BattleStat::Attack,
            before: change.mutation.before,
            after: change.mutation.after,
        });
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
) -> Result<(), BattleResolveError> {
    let rng_before = active_battle(state)?.battle_rng.clone();
    let result = {
        let battle = active_battle_mut(state)?;
        resolve_move(battle, &action.command, content, runtime, gate)?
    };
    sync_rng_state(state, runtime)?;
    let rng_after = active_battle(state)?.battle_rng.clone();

    push_pending_action(action_order, action, move_disposition(&result))?;
    if let Some(pp) = result.pp_mutation {
        mutations.push(BattleMutation::PpChanged {
            pokemon: pp.pokemon,
            move_slot: pp.move_slot,
            before: pp.before,
            after: pp.after,
        });
    }
    if rng_before != rng_after {
        mutations.push(BattleMutation::BattleRngChanged {
            before: rng_before,
            after: rng_after,
        });
    }

    for target in &result.targets {
        append_target_mutations(target, mutations);
        if let Some(request) = target.faint_request {
            queue_faint_action(
                state,
                FaintCandidate::from(&request),
                authority_epoch,
                turn_occurrence,
                action_order,
                mutations,
            )?;
        }
    }
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

fn append_target_mutations(target: &MoveTargetResult, mutations: &mut Vec<BattleMutation>) {
    if let Some(hp) = target.hp_mutation {
        mutations.push(BattleMutation::HpChanged {
            pokemon: hp.pokemon,
            before: hp.before,
            after: hp.after,
        });
    }
    for status in &target.status_effects {
        if let StatusApplicationOutcome::Applied { mutation } = status {
            if let Some(pokemon) = target.pokemon {
                mutations.push(BattleMutation::StatusChanged {
                    pokemon,
                    before: mutation.before,
                    after: mutation.after,
                });
            }
        }
    }
    for stage in &target.stat_stage_effects {
        if stage.changed {
            if let Some(pokemon) = target.pokemon {
                mutations.push(BattleMutation::StatStageChanged {
                    pokemon,
                    stat: stage.stat,
                    before: stage.before,
                    after: stage.after,
                });
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
        })?;
        let StatusResidualOutcome::Applied { mutation } = outcome else {
            continue;
        };

        let speed = effective_speed(&pokemon)?;
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
        mutations.push(BattleMutation::StatusChanged {
            pokemon: pokemon_id,
            before: mutation.status_before,
            after: mutation.status_after,
        });
        mutations.push(BattleMutation::HpChanged {
            pokemon: pokemon_id,
            before: mutation.hp_before,
            after: mutation.hp_after,
        });

        if mutation.hp_after == 0 {
            queue_faint_action(
                state,
                FaintCandidate::new(pokemon_id, slot),
                authority_epoch,
                turn_occurrence,
                action_order,
                mutations,
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
) -> Result<(), BattleResolveError> {
    let speed = effective_speed(find_pokemon(state, candidate.slot, candidate.pokemon)?)?;
    let queued = {
        let battle = active_battle_mut(state)?;
        queue_faint(battle, candidate, authority_epoch, *turn_occurrence)?
    };
    *turn_occurrence = turn_occurrence
        .checked_add(1)
        .ok_or(FaintQueueError::TurnOccurrenceOverflow)?;
    mutations.push(queued.mutation);
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
) -> Result<(), BattleResolveError> {
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
    Ok(())
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

fn clear_command_collection(
    state: &mut GameState,
    mutations: &mut Vec<BattleMutation>,
) -> Result<(), BattleResolveError> {
    let battle = active_battle_mut(state)?;
    let before = battle.command_state.clone();
    let after = CommandCollectionState::new(Vec::new(), before.tombstones.clone())
        .map_err(CommandLegalityError::Command)?;
    if before != after {
        battle.command_state = after.clone();
        mutations.push(BattleMutation::CommandCollectionChanged { before, after });
    }
    Ok(())
}

fn advance_turn_boundary(
    state: &mut GameState,
    runtime: &mut RngRuntime,
    mutations: &mut Vec<BattleMutation>,
) -> Result<(), BattleResolveError> {
    let before_turn = active_battle(state)?.turn;
    let before_rng = active_battle(state)?.battle_rng.clone();
    runtime.increment_turn()?;
    sync_rng_state(state, runtime)?;
    let after_turn = active_battle(state)?.battle_rng.turn;
    let after_rng = active_battle(state)?.battle_rng.clone();
    active_battle_mut(state)?.turn = after_turn;
    if before_rng != after_rng {
        mutations.push(BattleMutation::BattleRngChanged {
            before: before_rng,
            after: after_rng,
        });
    }
    mutations.push(BattleMutation::TurnAdvanced {
        before: before_turn,
        after: after_turn,
    });
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
        .ok_or_else(|| CommandLegalityError::ActorMismatch {
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
        .ok_or_else(|| CommandLegalityError::ActorMismatch {
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

fn validate_after_state(
    state: &GameState,
    content: &ContentPack,
) -> Result<(), BattleResolveError> {
    match validate_state_content(state, content) {
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
) -> Result<(), BattleResolveError> {
    loop {
        let Some(head) = unresolved_head(battle) else {
            return Ok(());
        };
        match head.replacement {
            ReplacementProgress::NotRequired => {
                let resolved = resolve_not_required(battle, head.id)?;
                mutations.extend(resolved.mutations);
            }
            ReplacementProgress::NoLegalReplacement => {
                let resolved = resolve_no_legal_replacement(battle, head.id)?;
                mutations.extend(resolved.mutations);
            }
            ReplacementProgress::Pending => {
                if compute_replacement_progress(battle, head.id)?
                    == ReplacementProgress::NoLegalReplacement
                {
                    let resolved = resolve_no_legal_replacement(battle, head.id)?;
                    mutations.extend(resolved.mutations);
                } else {
                    return Ok(());
                }
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

fn update_outcome(battle: &mut BattleState, mutations: &mut Vec<BattleMutation>) {
    let before = battle.outcome;
    let after = derive_battle_outcome(battle);
    if before != after {
        battle.outcome = after;
        mutations.push(BattleMutation::OutcomeChanged { before, after });
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
