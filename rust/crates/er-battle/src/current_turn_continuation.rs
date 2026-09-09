//! Action-boundary execution. Interlude release belongs to the current phase owner.

use super::*;
use er_state::current_turn_execution::{CurrentTurnExecutionV1, CurrentTurnFaintV1, CurrentTurnStageV1};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentTurnChunkV1 {
    pub transition: BattleTransitionV5,
    pub continuation: CurrentTurnExecutionV1,
}

#[derive(Default)]
struct ChunkEffects {
    actions: Vec<ResolvedAction>,
    mutations: Vec<BattleMutation>,
    presentation: Vec<BattlePresentationCueV5>,
    mechanics: Vec<MechanicsOperationEvidenceV2>,
}

/// Select and shuffle exactly once. No action or turn-end work executes here.
pub fn begin_current_turn(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
    targeting: &CurrentTargetExecution<'_>,
    next_rng_sequence: SafeU53,
) -> Result<CurrentTurnChunkV1, BattleV5Error> {
    verify_v5_dispatch_closure(content)?;
    before.validate().map_err(|error| BattleV5Error::State(error.to_string()))?;
    commands.validate().map_err(|error| BattleV5Error::Commands(error.to_string()))?;
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(BattleV5Error::NoBattle)?;
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    if battle.authority_seat != authority.authority_seat { return Err(BattleV5Error::AuthoritySeat); }
    let mut rng = RngRuntime::from_states_at_sequence(run.run_rng.clone(), Some(battle.battle_rng.clone()), next_rng_sequence)
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    let mut actions = build_actions(run, commands, content, Some(targeting))?;
    rng.speed_order_shuffle(&mut actions, &battle.wave_seed, battle.turn)
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    actions.sort_by(|left, right| right.priority.cmp(&left.priority)
        .then_with(|| right.effective_speed.cmp(&left.effective_speed)));
    let owner = CurrentTurnExecutionV1 {
        run: run.run_id, battle: battle.battle_id, wave: battle.wave, turn: battle.turn,
        authority: authority.authority_seat, authority_revision: authority.revision,
        accepted_commands: commands.clone(), actions, next_action: 0,
        next_rng_sequence: rng.next_audit_sequence().ok_or(BattleV5Error::Overflow)?,
        next_faint_sequence: SafeU53::ZERO,
        finalization_done: false, stage: CurrentTurnStageV1::ReadyForMove,
    };
    let transition = make_chunk(before, after, &owner, rng, ChunkEffects::default())?;
    Ok(CurrentTurnChunkV1 { transition, continuation: owner })
}

/// Execute one complete selected action, yielding before another queued action.
pub fn step_current_turn(
    before: &GameStateV5,
    owner: &CurrentTurnExecutionV1,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
    targeting: &CurrentTargetExecution<'_>,
) -> Result<CurrentTurnChunkV1, BattleV5Error> {
    advance_current_turn(before, owner, content, authority, targeting, false)
}

/// Finalize once, only after every selected action and its interlude has drained.
pub fn finish_current_turn(
    before: &GameStateV5,
    owner: &CurrentTurnExecutionV1,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
    targeting: &CurrentTargetExecution<'_>,
) -> Result<CurrentTurnChunkV1, BattleV5Error> {
    advance_current_turn(before, owner, content, authority, targeting, true)
}

fn advance_current_turn(
    before: &GameStateV5,
    owner: &CurrentTurnExecutionV1,
    content: &PreparedBattleContentV3,
    authority: &TurnAuthorityContextV1,
    targeting: &CurrentTargetExecution<'_>,
    finalize: bool,
) -> Result<CurrentTurnChunkV1, BattleV5Error> {
    before.validate().map_err(|error| BattleV5Error::State(error.to_string()))?;
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(BattleV5Error::NoBattle)?;
    owner.validate(run).map_err(|error| BattleV5Error::State(error.to_string()))?;
    if authority.authority_seat != owner.authority || authority.revision != owner.authority_revision {
        return Err(BattleV5Error::AuthoritySeat);
    }
    if owner.stage != CurrentTurnStageV1::ReadyForMove || owner.finalization_done
        || finalize != (usize::from(owner.next_action) == owner.actions.len()) {
        return Err(BattleV5Error::State("current turn has an unresolved interlude or wrong action frontier".to_owned()));
    }
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    let mut rng = RngRuntime::from_states_at_sequence(run.run_rng.clone(), Some(battle.battle_rng.clone()), owner.next_rng_sequence)
        .map_err(|error| BattleV5Error::Rng(error.to_string()))?;
    let mut next = owner.clone();
    let mut action_order = Vec::new();
    let mut mutations = Vec::new();
    let mut presentation = Vec::new();
    let mut mechanics = Vec::new();
    if finalize {
        finalize_turn(run, &mut rng, &mut mutations, &mut presentation)?;
        next.finalization_done = true;
        next.stage = CurrentTurnStageV1::Complete;
    } else {
        let index = usize::from(next.next_action);
        let action = next.actions[index].clone();
        let disposition = if actor_is_active(run, action.source_slot, action.command.actor()) {
            execute_action(run, &action, content, Some(targeting), &mut rng, &mut mutations,
                &mut presentation, &mut mechanics)?
        } else { ActionDisposition::SkippedActorInactive };
        let sequence = SafeU53::new(index as u64).map_err(|_| BattleV5Error::Overflow)?;
        action_order.push(ResolvedAction {
            sequence, kind: match action.command { BattleCommand::Fight { .. } => ResolvedActionKind::Move,
                BattleCommand::Switch { .. } => ResolvedActionKind::Switch },
            actor: action.command.actor(), source_slot: action.source_slot,
            command_operation_id: Some(action.accepted.operation_id().clone()), effective_speed: action.effective_speed,
            timing_modifier: if matches!(action.command, BattleCommand::Switch { .. }) { 6 } else { 0 },
            move_priority: action.priority, bracket_modifier: 0, tie_order: sequence, disposition,
        });
        next.next_action = next.next_action.checked_add(1).ok_or(BattleV5Error::Overflow)?;
    }
    let battle = run.battle.as_ref().ok_or(BattleV5Error::NoBattle)?;
    let mut faints = Vec::new();
    for mutation in &mutations {
        if let BattleMutation::HpChanged { pokemon, before, after } = mutation {
            if *before == 0 || *after != 0 { continue; }
            let slot = battle.field.slots.iter().find(|row| row.occupant == Some(*pokemon))
                .map(|row| row.slot).ok_or(BattleV5Error::Target)?;
            faints.push(CurrentTurnFaintV1 { id: next.next_faint_sequence, pokemon: *pokemon, slot });
            next.next_faint_sequence = SafeU53::new(next.next_faint_sequence.get().checked_add(1)
                .ok_or(BattleV5Error::Overflow)?).map_err(|_| BattleV5Error::Overflow)?;
        }
    }
    if !faints.is_empty() { next.stage = CurrentTurnStageV1::AwaitingInterlude { faints }; }
    next.next_rng_sequence = rng.next_audit_sequence().ok_or(BattleV5Error::Overflow)?;
    let transition = make_chunk(before, after, &next, rng, ChunkEffects {
        actions: action_order, mutations, presentation, mechanics,
    })?;
    Ok(CurrentTurnChunkV1 { transition, continuation: next })
}

fn make_chunk(
    before: &GameStateV5,
    mut after: GameStateV5,
    owner: &CurrentTurnExecutionV1,
    rng: RngRuntime,
    effects: ChunkEffects,
) -> Result<BattleTransitionV5, BattleV5Error> {
    let run = after.active_run.as_mut().ok_or(BattleV5Error::NoBattle)?;
    run.run_rng = rng.run_state();
    let battle = run.battle.as_mut().ok_or(BattleV5Error::NoBattle)?;
    battle.battle_rng = rng.battle_state().cloned().ok_or(BattleV5Error::NoBattle)?;
    let outcome = battle.outcome;
    let next_control = if owner.stage != CurrentTurnStageV1::Complete || outcome != BattleOutcome::Ongoing {
        GameControlKindV2::Waiting
    } else if battle.faint_queue.iter().any(|occurrence| occurrence.slot.side == BattleSide::Player
        && matches!(occurrence.replacement, er_types::battle_model::ReplacementProgress::Pending
            | er_types::battle_model::ReplacementProgress::Selected { .. })) {
        GameControlKindV2::BattleReplacement
    } else { GameControlKindV2::BattleCommand };
    run.control.kind = next_control;
    run.control.actionable = false;
    run.control.action_context = None;
    run.control.menu = None;
    owner.validate(run).map_err(|error| BattleV5Error::State(error.to_string()))?;
    after.validate().map_err(|error| BattleV5Error::State(error.to_string()))?;
    Ok(BattleTransitionV5 {
        before_digest: mechanical_digest(before)?, after_digest: mechanical_digest(&after)?, after_state: after,
        accepted_commands: owner.accepted_commands.clone(), action_order: effects.actions,
        mutations: effects.mutations, presentation: effects.presentation,
        mechanics_evidence: effects.mechanics.into_iter().map(Into::into).collect(),
        rng_audit: rng.audit_entries().to_vec(), outcome, next_control,
    })
}
