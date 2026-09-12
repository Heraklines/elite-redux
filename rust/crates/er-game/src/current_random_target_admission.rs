//! Source command-stage random targeting, before authority AI preparation.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_battle::current_target_execution::CurrentTargetExecution;
use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_state::current_random_target_commands::{
    CurrentRandomTargetCommandV1, CurrentRandomTargetCommandsV1,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandSet,
};

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Domain("current random target command admission failed".to_owned())
}

/// Produces a provisional state for AI input; common material execution calls
/// the same source function from the unchanged preimage before committing it.
pub fn stage_human_command(
    before: &GameStateV6,
    proposal: &BattleCommandProposalV1,
    content: &PreparedGameContentV2,
) -> Result<(GameStateV6, Vec<RngDraw>), GameRuntimeV6Error> {
    if before.current_targeting.is_none() {
        return Ok((before.clone(), vec![]));
    }
    if before.current_turn_execution.is_some() {
        return Err(failure());
    }
    proposal.validate().map_err(|_| failure())?;
    let BattleCommand::Fight {
        actor,
        move_slot,
        targets,
    } = &proposal.command
    else {
        return Ok((before.clone(), vec![]));
    };
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let pokemon = run
        .party
        .iter()
        .find(|pokemon| pokemon.id == *actor && pokemon.owner_seat == Some(proposal.owner_seat))
        .ok_or_else(failure)?;
    let (definition, struggle) =
        er_battle::m7_resolver::effective_move_definition_v5(&content.battle, pokemon, *move_slot)
            .map_err(|_| failure())?;
    if definition.id.get().get() != 165 {
        return Ok((before.clone(), vec![]));
    }
    if !struggle
        || *targets != BattleTargetSelection::Implicit
        || proposal.actor != *actor
        || proposal.battle_id != battle.battle_id
        || proposal.wave != battle.wave
        || proposal.turn != battle.turn
        || !battle
            .field
            .slots
            .iter()
            .any(|row| row.slot == proposal.field_slot && row.occupant == Some(*actor))
    {
        return Err(failure());
    }
    let accepted = AcceptedBattleCommand::human(proposal.clone());
    let mut owner =
        before
            .current_random_target_commands
            .clone()
            .unwrap_or(CurrentRandomTargetCommandsV1 {
                run: run.run_id,
                battle: battle.battle_id,
                wave: battle.wave,
                turn: battle.turn,
                entries: vec![],
            });
    if owner.run != run.run_id
        || owner.battle != battle.battle_id
        || owner.wave != battle.wave
        || owner.turn != battle.turn
    {
        return Err(failure());
    }
    if let Some(entry) = owner
        .entries
        .iter()
        .find(|entry| entry.command.operation_id() == accepted.operation_id())
    {
        if entry.command != accepted {
            return Err(failure());
        }
        return Ok((before.clone(), vec![]));
    }
    // A previously admitted command without its proof must fail on restore;
    // it must never be interpreted as a request to spend RNG again.
    if battle
        .command_state
        .frontier
        .iter()
        .any(|row| row.operation_id == proposal.operation_id)
        || owner.entries.len() >= 2
        || owner
            .entries
            .iter()
            .any(|entry| entry.command.field_slot() == proposal.field_slot)
    {
        return Err(failure());
    }
    let targeting = CurrentTargetExecution::from_state(before).map_err(|_| failure())?;
    let slots = targeting
        .random_command_candidates(run, *actor, definition)
        .map_err(|_| failure())?;
    let candidates = slots
        .iter()
        .map(|slot| {
            battle
                .field
                .slots
                .iter()
                .find(|row| row.slot == *slot)
                .and_then(|row| row.occupant)
                .map(|id| (*slot, id))
                .ok_or_else(failure)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let sequence = match owner.entries.last() {
        Some(entry) => SafeU53::new(
            entry
                .draw
                .sequence
                .get()
                .checked_add(1)
                .ok_or_else(failure)?,
        )
        .map_err(|_| failure())?,
        None => SafeU53::ZERO,
    };
    let mut rng = RngRuntime::from_states_at_sequence(
        run.run_rng.clone(),
        Some(battle.battle_rng.clone()),
        sequence,
    )
    .map_err(|_| failure())?;
    let result = rng
        .battle_rand_seed_int(
            SafeU53::new(u64::try_from(candidates.len()).map_err(|_| failure())?)
                .map_err(|_| failure())?,
            SafeU53::ZERO,
            RngReason::RandomTarget,
            RngCallsiteId::current_move_target(),
        )
        .map_err(|_| failure())?;
    let selected = candidates
        .get(usize::try_from(result.get()).map_err(|_| failure())?)
        .ok_or_else(failure)?
        .0;
    let draw = rng.audit_entries().first().cloned().ok_or_else(failure)?;
    owner.entries.push(CurrentRandomTargetCommandV1 {
        command: accepted,
        candidates,
        selected,
        draw: draw.clone(),
    });
    let mut candidate = before.clone();
    let run = candidate.active_run.as_mut().ok_or_else(failure)?;
    run.run_rng = rng.run_state();
    run.battle.as_mut().ok_or_else(failure)?.battle_rng =
        rng.battle_state().cloned().ok_or_else(failure)?;
    candidate.current_random_target_commands = Some(owner);
    Ok((candidate, vec![draw]))
}

pub(crate) fn stage_complete_commands(
    before: &GameStateV6,
    commands: &CommandSet,
    content: &PreparedGameContentV2,
) -> Result<(GameStateV6, Vec<RngDraw>), GameRuntimeV6Error> {
    let battle = before
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or_else(failure)?;
    let new_humans = commands
        .entries
        .iter()
        .filter(|accepted| {
            matches!(accepted, AcceptedBattleCommand::Human { .. })
                && !battle
                    .command_state
                    .frontier
                    .iter()
                    .any(|row| &row.operation_id == accepted.operation_id())
        })
        .count();
    let mut candidate = before.clone();
    let mut audit = Vec::new();
    for accepted in &commands.entries {
        if let AcceptedBattleCommand::Human { proposal, .. } = accepted {
            let (next, draws) = stage_human_command(&candidate, proposal, content)?;
            if !draws.is_empty() && new_humans != 1 {
                return Err(failure()); // Earlier humans require their own retained admission order.
            }
            candidate = next;
            audit.extend(draws);
        }
    }
    Ok((candidate, audit))
}

/// Bind source draw proofs to the prior material state. Structural snapshot
/// validation alone cannot establish which random state preceded admission.
pub(crate) fn validate_transition(
    prior: Option<&GameStateV6>,
    content: &PreparedGameContentV2,
    transition: &crate::m9e_material_v6::GameTransitionMaterialV6,
) -> Result<(), GameRuntimeV6Error> {
    let after = &transition.after_state;
    let Some(prior) = prior else {
        return if after.current_random_target_commands.is_none() {
            Ok(())
        } else {
            Err(failure())
        };
    };
    if prior.current_random_target_commands == after.current_random_target_commands {
        return Ok(());
    }
    let identity = |state: &GameStateV6| {
        state.active_run.as_ref().and_then(|run| {
            run.battle
                .as_ref()
                .map(|battle| (run.run_id, battle.battle_id, battle.wave, battle.turn))
        })
    };
    if after.current_random_target_commands.is_none() && identity(prior) != identity(after) {
        return Ok(()); // The existing owned phase/terminal validator proves this boundary.
    }
    if prior.current_turn_execution.is_none() && after.current_turn_execution.is_some() {
        return Ok(()); // validate_current_turn_transition recomputes the complete begin candidate.
    }
    if prior.current_turn_execution.is_some()
        || after.current_turn_execution.is_some()
        || transition.owned_phase.is_some()
        || transition.domain != crate::m9e_material_v6::GameActionDomainV2::BattleTurn
    {
        return Err(failure());
    }
    let owner = after
        .current_random_target_commands
        .as_ref()
        .ok_or_else(failure)?;
    let previous = prior
        .current_random_target_commands
        .as_ref()
        .map(|owner| owner.entries.as_slice())
        .unwrap_or(&[]);
    if owner.entries.len() != previous.len() + 1 || owner.entries[..previous.len()] != *previous {
        return Err(failure());
    }
    let entry = owner.entries.last().ok_or_else(failure)?;
    let AcceptedBattleCommand::Human { proposal, .. } = &entry.command else {
        return Err(failure());
    };
    let BattleCommand::Fight {
        actor, move_slot, ..
    } = &proposal.command
    else {
        return Err(failure());
    };
    if transition.operation_id != proposal.operation_id
        || transition.authority_seat
            != prior
                .active_run
                .as_ref()
                .and_then(|run| run.battle.as_ref())
                .ok_or_else(failure)?
                .authority_seat
        || transition.accepted_action
            != Some(er_types::GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove {
                    actor: *actor,
                    move_slot: *move_slot,
                },
            })
    {
        return Err(failure());
    }
    let (expected, audit) = stage_human_command(prior, proposal, content)?;
    if expected.current_random_target_commands != after.current_random_target_commands
        || audit != transition.rng_audit
        || expected.active_run.as_ref().map(|run| &run.run_rng)
            != after.active_run.as_ref().map(|run| &run.run_rng)
        || expected
            .active_run
            .as_ref()
            .and_then(|run| run.battle.as_ref())
            .map(|battle| &battle.battle_rng)
            != after
                .active_run
                .as_ref()
                .and_then(|run| run.battle.as_ref())
                .map(|battle| &battle.battle_rng)
    {
        return Err(failure());
    }
    Ok(())
}

pub(crate) fn validate_live_pending_commands(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(), GameRuntimeV6Error> {
    let run = state.active_run.as_ref().ok_or_else(failure)?;
    let Some(battle) = run.battle.as_ref() else {
        return if state.current_random_target_commands.is_none()
            && state.current_turn_execution.is_none()
        {
            Ok(())
        } else {
            Err(failure())
        };
    };
    for row in &battle.command_state.frontier {
        let command = match &row.status {
            er_types::battle_command::CommandFrontierStatus::Retained { command, .. }
            | er_types::battle_command::CommandFrontierStatus::Admitted { command, .. } => command,
            er_types::battle_command::CommandFrontierStatus::Pending => continue,
        };
        if state.current_turn_execution.is_some() {
            break;
        }
        let AcceptedBattleCommand::Human { proposal, .. } = command else {
            continue;
        };
        let BattleCommand::Fight {
            actor, move_slot, ..
        } = &proposal.command
        else {
            continue;
        };
        let pokemon = run
            .party
            .iter()
            .find(|pokemon| pokemon.id == *actor)
            .ok_or_else(failure)?;
        let (_, struggle) = er_battle::m7_resolver::effective_move_definition_v5(
            &content.battle,
            pokemon,
            *move_slot,
        )
        .map_err(|_| failure())?;
        if struggle
            && !state
                .current_random_target_commands
                .as_ref()
                .is_some_and(|owner| owner.entries.iter().any(|entry| &entry.command == command))
        {
            return Err(failure());
        }
    }
    let Some(turn) = &state.current_turn_execution else {
        return Ok(());
    };
    for action in turn.actions.iter().skip(usize::from(turn.next_action)) {
        let AcceptedBattleCommand::Human { proposal, .. } = &action.accepted else {
            continue;
        };
        let BattleCommand::Fight {
            actor, move_slot, ..
        } = &proposal.command
        else {
            continue;
        };
        let pokemon = run
            .party
            .iter()
            .find(|pokemon| pokemon.id == *actor)
            .ok_or_else(failure)?;
        if pokemon.fainted || pokemon.hp == 0 {
            continue;
        }
        let (_, struggle) = er_battle::m7_resolver::effective_move_definition_v5(
            &content.battle,
            pokemon,
            *move_slot,
        )
        .map_err(|_| failure())?;
        if struggle
            && !state
                .current_random_target_commands
                .as_ref()
                .is_some_and(|owner| {
                    owner
                        .entries
                        .iter()
                        .any(|entry| entry.command == action.accepted)
                })
        {
            return Err(failure());
        }
    }
    Ok(())
}
