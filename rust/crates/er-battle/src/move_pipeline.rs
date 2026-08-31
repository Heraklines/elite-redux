//! Action-level ordering and state boundary for the selected M3 move slice.
//!
//! This module is deliberately narrower than the later turn resolver.  It
//! stages a single move against a `BattleState` and `RngRuntime`, performs the
//! frozen actor/PP/paralysis and per-target ordering, then commits only the
//! real battle-state mutations.  It does not synchronize
//! `BattleState.battle_rng`, allocate presentation/faint IDs, or resolve an
//! outcome; those responsibilities remain with the integration lane.

use er_content::moves::find_move;
use er_content::pack::{ContentPack, ContentPackError};
use er_rng::battle::RngRuntime;
use er_state::battle::BattleState;
use er_state::pokemon::{PokemonState, PpValidationError, move_slot_is_usable, validate_move_slot};
use er_types::battle_ids::{FieldSlot, MoveSlotIndex, PokemonId};
use er_types::battle_model::MoveTarget;
use thiserror::Error;

use crate::command::NormalizedBattleCommand;
use crate::move_effect::{
    DefensiveAbilityGate, FaintRequest, MoveEffectError, MoveTargetResult,
    resolve_target_effect_validated,
};
use crate::status::{ParalysisActivationOutcome, StatusError, check_paralysis};

/// The action-level disposition after the actor guard and first-failure gate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MovePipelineDisposition {
    SkippedActorInactive,
    CancelledByParalysis,
    Executed,
}

/// One real PP mutation, emitted exactly once for a move that passes the
/// first-failure checks.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PpMutation {
    pub pokemon: PokemonId,
    pub move_slot: MoveSlotIndex,
    pub before: u16,
    pub after: u16,
}

/// Semantic result of one staged move action.
#[derive(Clone, Debug, PartialEq)]
pub struct MovePipelineResult {
    pub actor: PokemonId,
    pub source_slot: FieldSlot,
    pub move_slot: MoveSlotIndex,
    /// The normalized command's move identity is retained on every Fight
    /// result, including an inactive-actor skip or paralysis cancellation.
    pub move_id: er_types::battle_ids::MoveId,
    pub disposition: MovePipelineDisposition,
    pub pp_mutation: Option<PpMutation>,
    pub paralysis: Option<ParalysisActivationOutcome>,
    pub targets: Vec<MoveTargetResult>,
    pub faint_requests: Vec<FaintRequest>,
}

/// The move pipeline accepts only a normalized Fight command.  Switches are
/// resolved by their later lane and must not be coerced into a move no-op.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum WrongCommandKind {
    #[error("move pipeline received a normalized switch command")]
    Switch,
}

/// Typed target-shape errors that are rejected before any RNG or state write.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum TargetSelectionError {
    #[error("target selection is empty")]
    Empty,
    #[error("near-other move requires exactly one target")]
    NearOtherCount,
    #[error("near-other target {slot:?} is not one canonical active adjacent candidate")]
    NearOtherNotCanonical { slot: FieldSlot },
    #[error("all-near-enemies move requires at least one target")]
    AllEnemiesCount,
    #[error("target {slot:?} is outside the battle format capacity")]
    SlotOutsideCapacity { slot: FieldSlot },
    #[error("target {slot:?} is on the actor's side")]
    SameSide { slot: FieldSlot },
    #[error("target selection contains duplicate slot {slot:?}")]
    Duplicate { slot: FieldSlot },
    #[error("target selection is not in canonical field-slot order")]
    NonCanonicalOrder,
    #[error(
        "all-near-enemies target selection does not exactly match the canonical active opposing candidates"
    )]
    AllEnemiesNotCanonical,
    #[error("move target {target:?} requires the GameKernelV7 target resolver")]
    UnsupportedTarget { target: MoveTarget },
}

/// Fail-closed errors for the action-level boundary.
#[derive(Debug, Error)]
pub enum MovePipelineError {
    #[error("immutable content pack is invalid: {0}")]
    Content(#[source] ContentPackError),
    #[error("wrong normalized command kind: {0}")]
    WrongCommandKind(#[from] WrongCommandKind),
    #[error("actor {actor:?} is missing from its field-side party state")]
    MissingActorState { actor: PokemonId, slot: FieldSlot },
    #[error("target {pokemon:?} in slot {slot:?} is missing from its field-side party state")]
    MissingTargetState { pokemon: PokemonId, slot: FieldSlot },
    #[error("move slot {move_slot:?} is empty for actor {actor:?}")]
    MissingMoveSlot {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
    },
    #[error(
        "normalized move {move_id:?} for actor {actor:?} at slot {move_slot:?} does not match state move {actual:?}"
    )]
    MoveIdentityMismatch {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        move_id: er_types::battle_ids::MoveId,
        actual: er_types::battle_ids::MoveId,
    },
    #[error("move {move_id:?} is outside the selected content slice")]
    UnsupportedMove {
        move_id: er_types::battle_ids::MoveId,
    },
    #[error("move {move_id:?} for actor {actor:?} has invalid PP: {source}")]
    InvalidPp {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        #[source]
        source: PpValidationError,
        move_id: er_types::battle_ids::MoveId,
    },
    #[error("move {move_id:?} for actor {actor:?} has no usable PP ({pp_used}/{max_pp})")]
    PpUnavailable {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        move_id: er_types::battle_ids::MoveId,
        pp_used: u16,
        max_pp: u16,
    },
    #[error("PP deduction overflowed for actor {actor:?} move slot {move_slot:?}")]
    PpOverflow {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
    },
    #[error("target selection is invalid: {0}")]
    TargetSelection(#[from] TargetSelectionError),
    #[error("paralysis first-failure check failed: {0}")]
    Paralysis(#[source] StatusError),
    #[error("move effect resolution failed: {0}")]
    Effect(#[from] MoveEffectError),
}

/// Resolve one normalized fight action through the closed M3 move pipeline.
///
/// State and RNG are cloned before any post-guard work.  Any typed failure
/// discards both staged values, while ordinary paralysis cancellation commits
/// its one activation draw but no PP or target mutation.  The caller-supplied
/// defensive gate is invoked only for damaging moves after native type
/// composition and before accuracy.
pub fn resolve_move<G: DefensiveAbilityGate>(
    battle: &mut BattleState,
    command: &NormalizedBattleCommand,
    content: &ContentPack,
    runtime: &mut RngRuntime,
    defensive_gate: &G,
) -> Result<MovePipelineResult, MovePipelineError> {
    resolve_move_with_content_validation(battle, command, content, runtime, defensive_gate, true)
}

/// Resolve one normalized move after the enclosing turn boundary has already
/// validated the immutable content pack and complete state/content binding.
pub(crate) fn resolve_move_validated<G: DefensiveAbilityGate>(
    battle: &mut BattleState,
    command: &NormalizedBattleCommand,
    content: &ContentPack,
    runtime: &mut RngRuntime,
    defensive_gate: &G,
) -> Result<MovePipelineResult, MovePipelineError> {
    resolve_move_with_content_validation(battle, command, content, runtime, defensive_gate, false)
}

fn resolve_move_with_content_validation<G: DefensiveAbilityGate>(
    battle: &mut BattleState,
    command: &NormalizedBattleCommand,
    content: &ContentPack,
    runtime: &mut RngRuntime,
    defensive_gate: &G,
    validate_content: bool,
) -> Result<MovePipelineResult, MovePipelineError> {
    let (actor_id, source_slot, move_slot, command_move_id, targets) = match command {
        NormalizedBattleCommand::Fight {
            actor,
            field_slot,
            move_slot,
            move_id,
            targets,
            ..
        } => (
            *actor,
            *field_slot,
            *move_slot,
            *move_id,
            targets.as_slice(),
        ),
        NormalizedBattleCommand::Switch { .. } => {
            return Err(MovePipelineError::WrongCommandKind(
                WrongCommandKind::Switch,
            ));
        }
    };

    // MovePhase's start guard is the first mechanical operation.  A queued
    // actor removed by an earlier phase is a semantic skip, not an error, and
    // must not inspect PP or consume RNG.
    let Some(occupant) = field_occupant(battle, source_slot) else {
        return Ok(skipped_actor_result(
            actor_id,
            source_slot,
            move_slot,
            command_move_id,
        ));
    };
    if occupant != actor_id {
        return Ok(skipped_actor_result(
            actor_id,
            source_slot,
            move_slot,
            command_move_id,
        ));
    }
    let actor = find_pokemon(battle, source_slot, actor_id).ok_or(
        MovePipelineError::MissingActorState {
            actor: actor_id,
            slot: source_slot,
        },
    )?;
    if actor.fainted || actor.hp == 0 {
        return Ok(skipped_actor_result(
            actor_id,
            source_slot,
            move_slot,
            command_move_id,
        ));
    }

    // Content validation is intentionally fail-closed.  In particular, an
    // unsupported reachable move is never coerced into a no-op definition.
    if validate_content {
        content.validate().map_err(MovePipelineError::Content)?;
    }
    let actor_snapshot = actor.clone();
    let move_slot_index = usize::from(move_slot.get());
    let selected_move_slot =
        actor_snapshot.moves[move_slot_index].ok_or(MovePipelineError::MissingMoveSlot {
            actor: actor_id,
            move_slot,
        })?;
    if selected_move_slot.move_id != command_move_id {
        return Err(MovePipelineError::MoveIdentityMismatch {
            actor: actor_id,
            move_slot,
            move_id: command_move_id,
            actual: selected_move_slot.move_id,
        });
    }
    let move_definition = find_move(&content.moves, command_move_id).map_err(|_| {
        MovePipelineError::UnsupportedMove {
            move_id: command_move_id,
        }
    })?;

    validate_targets(battle, source_slot, targets, move_definition.target)?;

    // PP validity/usability is checked before the paralysis activation draw.
    let max_pp =
        validate_move_slot(&selected_move_slot, move_definition.base_pp).map_err(|source| {
            MovePipelineError::InvalidPp {
                actor: actor_id,
                move_slot,
                source,
                move_id: command_move_id,
            }
        })?;
    if !move_slot_is_usable(&selected_move_slot, move_definition.base_pp).map_err(|source| {
        MovePipelineError::InvalidPp {
            actor: actor_id,
            move_slot,
            source,
            move_id: command_move_id,
        }
    })? {
        return Err(MovePipelineError::PpUnavailable {
            actor: actor_id,
            move_slot,
            move_id: command_move_id,
            pp_used: selected_move_slot.pp_used,
            max_pp,
        });
    }

    let mut staged_battle = battle.clone();
    let mut staged_runtime = runtime.clone();
    let paralysis = check_paralysis(&mut staged_runtime, actor_snapshot.status.kind)
        .map_err(MovePipelineError::Paralysis)?;
    if let ParalysisActivationOutcome::FullyParalyzed { .. } = paralysis {
        *runtime = staged_runtime;
        return Ok(MovePipelineResult {
            actor: actor_id,
            source_slot,
            move_slot,
            move_id: command_move_id,
            disposition: MovePipelineDisposition::CancelledByParalysis,
            pp_mutation: None,
            paralysis: Some(paralysis),
            targets: Vec::new(),
            faint_requests: Vec::new(),
        });
    }

    let pp_mutation = deduct_pp(&mut staged_battle, source_slot, actor_id, move_slot)?;
    let actor_snapshot = find_pokemon(&staged_battle, source_slot, actor_id)
        .ok_or(MovePipelineError::MissingActorState {
            actor: actor_id,
            slot: source_slot,
        })?
        .clone();
    let abilities_ignored = staged_battle.global_ability_suppression.ignore_abilities;

    let mut targets_results = Vec::with_capacity(targets.len());
    let mut faint_requests = Vec::new();
    for target_slot in targets.iter().copied() {
        let Some(target_id) = field_occupant(&staged_battle, target_slot) else {
            targets_results.push(MoveTargetResult::skipped_target_inactive(target_slot, None));
            continue;
        };
        let target_state = find_pokemon(&staged_battle, target_slot, target_id).ok_or(
            MovePipelineError::MissingTargetState {
                pokemon: target_id,
                slot: target_slot,
            },
        )?;
        if target_state.fainted || target_state.hp == 0 {
            targets_results.push(MoveTargetResult::skipped_target_inactive(
                target_slot,
                Some(target_id),
            ));
            continue;
        }

        let target_state = find_pokemon_mut(&mut staged_battle, target_slot, target_id).ok_or(
            MovePipelineError::MissingTargetState {
                pokemon: target_id,
                slot: target_slot,
            },
        )?;
        let target_result = resolve_target_effect_validated(
            &mut staged_runtime,
            &actor_snapshot,
            target_slot,
            target_state,
            move_definition,
            content,
            targets.len(),
            abilities_ignored,
            defensive_gate,
        )?;
        if let Some(request) = target_result.faint_request {
            faint_requests.push(request);
        }
        targets_results.push(target_result);
    }

    *battle = staged_battle;
    *runtime = staged_runtime;
    Ok(MovePipelineResult {
        actor: actor_id,
        source_slot,
        move_slot,
        move_id: command_move_id,
        disposition: MovePipelineDisposition::Executed,
        pp_mutation: Some(pp_mutation),
        paralysis: Some(paralysis),
        targets: targets_results,
        faint_requests,
    })
}

fn skipped_actor_result(
    actor: PokemonId,
    source_slot: FieldSlot,
    move_slot: MoveSlotIndex,
    move_id: er_types::battle_ids::MoveId,
) -> MovePipelineResult {
    MovePipelineResult {
        actor,
        source_slot,
        move_slot,
        move_id,
        disposition: MovePipelineDisposition::SkippedActorInactive,
        pp_mutation: None,
        paralysis: None,
        targets: Vec::new(),
        faint_requests: Vec::new(),
    }
}

fn validate_targets(
    battle: &BattleState,
    source_slot: FieldSlot,
    targets: &[FieldSlot],
    move_target: MoveTarget,
) -> Result<(), TargetSelectionError> {
    if !matches!(
        move_target,
        MoveTarget::NearOther | MoveTarget::AllNearEnemies
    ) {
        return Err(TargetSelectionError::UnsupportedTarget {
            target: move_target,
        });
    }
    let actor_side = source_slot.side;
    if targets.is_empty() {
        return Err(match move_target {
            MoveTarget::NearOther => TargetSelectionError::Empty,
            MoveTarget::AllNearEnemies => TargetSelectionError::AllEnemiesCount,
            target => TargetSelectionError::UnsupportedTarget { target },
        });
    }
    if move_target == MoveTarget::NearOther && targets.len() != 1 {
        return Err(TargetSelectionError::NearOtherCount);
    }
    if move_target == MoveTarget::AllNearEnemies && targets.is_empty() {
        return Err(TargetSelectionError::AllEnemiesCount);
    }
    // Revalidate the live structural candidates before PP, paralysis, or any
    // target effect work. A queued target may have been vacated or malformed
    // since admission, while a properly fainted target remains an admissible
    // typed no-op for the later target loop.
    let expected = structural_target_candidates(battle, source_slot, move_target);
    for (index, target) in targets.iter().copied().enumerate() {
        if !slot_within_format_capacity(battle, target) {
            return Err(TargetSelectionError::SlotOutsideCapacity { slot: target });
        }
        if move_target == MoveTarget::AllNearEnemies && target.side == actor_side {
            return Err(TargetSelectionError::SameSide { slot: target });
        }
        if targets[..index].contains(&target) {
            return Err(TargetSelectionError::Duplicate { slot: target });
        }
        if let Some(previous) = index.checked_sub(1).and_then(|i| targets.get(i))
            && *previous >= target
        {
            return Err(TargetSelectionError::NonCanonicalOrder);
        }
    }
    match move_target {
        MoveTarget::NearOther => {
            let target = targets[0];
            if !expected.contains(&target) {
                return Err(TargetSelectionError::NearOtherNotCanonical { slot: target });
            }
        }
        MoveTarget::AllNearEnemies => {
            if expected.is_empty() {
                return Err(TargetSelectionError::AllEnemiesCount);
            }
            if targets != expected.as_slice() {
                return Err(TargetSelectionError::AllEnemiesNotCanonical);
            }
        }
        target => return Err(TargetSelectionError::UnsupportedTarget { target }),
    }
    Ok(())
}

fn slot_within_format_capacity(battle: &BattleState, slot: FieldSlot) -> bool {
    let capacity = match slot.side {
        er_types::battle_ids::BattleSide::Player => battle.format.player_capacity,
        er_types::battle_ids::BattleSide::Enemy => battle.format.enemy_capacity,
    };
    slot.position < capacity
}

fn structural_target_candidates(
    battle: &BattleState,
    actor_slot: FieldSlot,
    target_kind: MoveTarget,
) -> Vec<FieldSlot> {
    if !matches!(
        target_kind,
        MoveTarget::NearOther | MoveTarget::AllNearEnemies
    ) {
        return Vec::new();
    }
    let mut candidates = battle
        .field
        .slots
        .iter()
        .filter_map(|entry| {
            if entry.slot == actor_slot
                || !slot_within_format_capacity(battle, entry.slot)
                || !battle.format.adjacency.iter().any(|edge| {
                    (edge.first == actor_slot && edge.second == entry.slot)
                        || (edge.first == entry.slot && edge.second == actor_slot)
                })
            {
                return None;
            }
            if target_kind == MoveTarget::AllNearEnemies && entry.slot.side == actor_slot.side {
                return None;
            }
            let occupant = entry.occupant?;
            let pokemon = find_pokemon(battle, entry.slot, occupant)?;
            let valid_state =
                (pokemon.hp > 0 && !pokemon.fainted) || (pokemon.hp == 0 && pokemon.fainted);
            valid_state.then_some(entry.slot)
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable();
    candidates
}

fn deduct_pp(
    battle: &mut BattleState,
    source_slot: FieldSlot,
    actor_id: PokemonId,
    move_slot: MoveSlotIndex,
) -> Result<PpMutation, MovePipelineError> {
    let actor = find_pokemon_mut(battle, source_slot, actor_id).ok_or(
        MovePipelineError::MissingActorState {
            actor: actor_id,
            slot: source_slot,
        },
    )?;
    let index = usize::from(move_slot.get());
    let selected = actor.moves[index]
        .as_mut()
        .ok_or(MovePipelineError::MissingMoveSlot {
            actor: actor_id,
            move_slot,
        })?;
    let before = selected.pp_used;
    let after = before.checked_add(1).ok_or(MovePipelineError::PpOverflow {
        actor: actor_id,
        move_slot,
    })?;
    selected.pp_used = after;
    Ok(PpMutation {
        pokemon: actor_id,
        move_slot,
        before,
        after,
    })
}

fn field_occupant(battle: &BattleState, slot: FieldSlot) -> Option<PokemonId> {
    battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == slot)
        .and_then(|entry| entry.occupant)
}

fn find_pokemon(
    battle: &BattleState,
    slot: FieldSlot,
    pokemon: PokemonId,
) -> Option<&PokemonState> {
    match slot.side {
        er_types::battle_ids::BattleSide::Player => {
            battle.player_party.iter().find(|state| state.id == pokemon)
        }
        er_types::battle_ids::BattleSide::Enemy => {
            battle.enemy_party.iter().find(|state| state.id == pokemon)
        }
    }
}

fn find_pokemon_mut(
    battle: &mut BattleState,
    slot: FieldSlot,
    pokemon: PokemonId,
) -> Option<&mut PokemonState> {
    match slot.side {
        er_types::battle_ids::BattleSide::Player => battle
            .player_party
            .iter_mut()
            .find(|state| state.id == pokemon),
        er_types::battle_ids::BattleSide::Enemy => battle
            .enemy_party
            .iter_mut()
            .find(|state| state.id == pokemon),
    }
}
