//! Pure charge/recharge/action-lock transitions for the M6 bespoke
//! `CHARGE_RECHARGE_LOCK` family.
//!
//! Every transition consumes typed canonical state by shared reference and
//! returns the updated lock plus deterministic evidence; inputs are never
//! mutated and never change on error. There is no implicit unlock: a lock is
//! released only by its final forced continuation, a consumed recharge skip,
//! or an explicit faint/switch cleanup, and every release emits evidence.
//! Competing commands are rejected instead of bypassed, so no semantic
//! command shortcut can slip past a live lock.

use er_state::bespoke_v2::action_lock::ActionLockStage;
use er_state::bespoke_v2::action_lock::ActionLockStateError;
use er_state::bespoke_v2::action_lock::ActionLockStateV2;
use er_types::BehaviorUnitId;
use er_types::MechanicScope;
use er_types::battle_ids::MoveId;
use thiserror::Error;

/// The only commands a locked actor may issue on its locked turn.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LockedTurnCommand {
    /// Engine-driven continuation of the charge lock's move. Legal only
    /// while a `Charging` lock is live, and only for the locked identity.
    ContinueLockedMove { move_id: MoveId },
    /// The mandatory skip a `Recharging` lock forces on its actor.
    ForcedRechargeSkip,
}

/// Closed reasons a live lock is cleaned up without completing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LockInterruption {
    /// The bound battler fainted; the lock dies with it.
    ActorFainted,
    /// The bound battler left the field; locks never survive a switch.
    ActorSwitchedOut,
}

/// One observed lock mutation in deterministic execution order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionLockEvent {
    pub kind: ActionLockEventKind,
    pub stage_before: Option<ActionLockStage>,
    pub stage_after: Option<ActionLockStage>,
    pub remaining_before: u16,
    pub remaining_after: u16,
}

/// Closed set of emitted lock events.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionLockEventKind {
    /// A new lock was acquired over empty state.
    Acquired,
    /// One charge turn was consumed; the lock stays live.
    ChargeTurnConsumed,
    /// The final charge continuation executed and released the lock.
    ReleasedAfterFinalContinuation,
    /// The mandatory recharge skip was consumed and released the lock.
    ReleasedAfterRechargeSkip,
    /// Cleanup after the bound battler fainted.
    ClearedOnFaint,
    /// Cleanup after the bound battler switched out.
    ClearedOnSwitchOut,
}

/// Typed output of one pure lock transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionLockTransition {
    /// Canonical lock after the transition; `None` once released.
    pub lock: Option<ActionLockStateV2>,
    /// Deterministic evidence in execution order.
    pub events: Vec<ActionLockEvent>,
}

/// Validated acquisition input.
#[derive(Clone, Debug)]
pub struct AcquireActionLock {
    pub owner: MechanicScope,
    pub locked_move_id: MoveId,
    pub stage: ActionLockStage,
    /// Strictly positive number of turns the lock spans.
    pub duration_turns: u16,
    pub source_behavior_unit: BehaviorUnitId,
}

/// Fail-closed action-lock errors. Every error leaves the canonical state
/// untouched.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ActionLockError {
    #[error(
        "an action lock is already active on {locked_move_id:?}; duplicate acquisition is forbidden"
    )]
    DuplicateAcquisition { locked_move_id: MoveId },
    #[error("action lock duration must be positive")]
    ZeroDuration,
    #[error("action lock owner must be a Pokemon scope")]
    OwnerNotAPokemonScope,
    #[error("locked move identity mismatch: lock binds {expected:?}, command attempted {actual:?}")]
    LockedMoveMismatch { expected: MoveId, actual: MoveId },
    #[error("competing command while a {stage:?} lock on {locked_move_id:?} is active")]
    CompetingCommandWhileLocked {
        stage: ActionLockStage,
        locked_move_id: MoveId,
    },
    #[error("canonical action lock state is invalid: {0}")]
    InvalidCanonicalState(#[source] ActionLockStateError),
}

/// Acquires the single action lock over empty lock state.
///
/// Fails closed when any lock already exists (no matter which actor holds
/// it), when the duration is zero, or when the owner is not a battler scope.
pub fn acquire_action_lock(
    existing: Option<&ActionLockStateV2>,
    request: &AcquireActionLock,
) -> Result<ActionLockTransition, ActionLockError> {
    if let Some(current) = existing {
        return Err(ActionLockError::DuplicateAcquisition {
            locked_move_id: current.locked_move_id,
        });
    }
    if request.duration_turns == 0 {
        return Err(ActionLockError::ZeroDuration);
    }
    if !matches!(request.owner, MechanicScope::Pokemon { .. }) {
        return Err(ActionLockError::OwnerNotAPokemonScope);
    }
    let lock = ActionLockStateV2 {
        stage: request.stage,
        owner: request.owner,
        locked_move_id: request.locked_move_id,
        source_behavior_unit: request.source_behavior_unit.clone(),
        remaining_turns: request.duration_turns,
    };
    lock.validate()
        .map_err(ActionLockError::InvalidCanonicalState)?;
    let stage_after = lock.stage;
    let remaining = lock.remaining_turns;
    Ok(ActionLockTransition {
        events: vec![ActionLockEvent {
            kind: ActionLockEventKind::Acquired,
            stage_before: None,
            stage_after: Some(stage_after),
            remaining_before: 0,
            remaining_after: remaining,
        }],
        lock: Some(lock),
    })
}

/// Resolves the locked actor's commanded turn against the live lock.
///
/// A charging lock accepts only a continuation of exactly its locked move;
/// anything else — including a recharge-style skip — is rejected as a
/// competing command. A recharging lock accepts only the forced skip; even
/// the previously locked identity stays illegal for the skip turn, so no
/// semantic command can bypass the recharge. The turn that exhausts the lock
/// releases it and the underlying move resolution proceeds unbound.
pub fn advance_locked_turn(
    existing: &ActionLockStateV2,
    command: &LockedTurnCommand,
) -> Result<ActionLockTransition, ActionLockError> {
    existing
        .validate()
        .map_err(ActionLockError::InvalidCanonicalState)?;
    match (existing.stage, command) {
        (ActionLockStage::Charging, LockedTurnCommand::ContinueLockedMove { move_id }) => {
            if *move_id != existing.locked_move_id {
                return Err(ActionLockError::LockedMoveMismatch {
                    expected: existing.locked_move_id,
                    actual: *move_id,
                });
            }
            consume_one_turn(existing, |remaining_after| {
                if remaining_after == 0 {
                    ActionLockEventKind::ReleasedAfterFinalContinuation
                } else {
                    ActionLockEventKind::ChargeTurnConsumed
                }
            })
        }
        (ActionLockStage::Recharging, LockedTurnCommand::ForcedRechargeSkip) => {
            consume_one_turn(existing, |_| ActionLockEventKind::ReleasedAfterRechargeSkip)
        }
        (stage, _) => Err(ActionLockError::CompetingCommandWhileLocked {
            stage,
            locked_move_id: existing.locked_move_id,
        }),
    }
}

/// Cleans up the live lock after the bound battler fainted or switched out.
///
/// Interruption always clears the whole lock regardless of remaining turns;
/// it never defers, converts, or re-arms the lock.
pub fn clear_lock_on_interruption(
    existing: &ActionLockStateV2,
    reason: LockInterruption,
) -> Result<ActionLockTransition, ActionLockError> {
    existing
        .validate()
        .map_err(ActionLockError::InvalidCanonicalState)?;
    let kind = match reason {
        LockInterruption::ActorFainted => ActionLockEventKind::ClearedOnFaint,
        LockInterruption::ActorSwitchedOut => ActionLockEventKind::ClearedOnSwitchOut,
    };
    Ok(ActionLockTransition {
        events: vec![ActionLockEvent {
            kind,
            stage_before: Some(existing.stage),
            stage_after: None,
            remaining_before: existing.remaining_turns,
            remaining_after: 0,
        }],
        lock: None,
    })
}

/// Consumes exactly one turn of a validated lock and releases it at zero.
fn consume_one_turn(
    existing: &ActionLockStateV2,
    classify: impl FnOnce(u16) -> ActionLockEventKind,
) -> Result<ActionLockTransition, ActionLockError> {
    let remaining_before = existing.remaining_turns;
    // Validation guarantees a positive duration, but the arithmetic still
    // refuses to wrap: a corrupt zero-duration lock fails closed here too.
    let remaining_after = remaining_before
        .checked_sub(1)
        .ok_or(ActionLockError::ZeroDuration)?;
    let mut lock = existing.clone();
    lock.remaining_turns = remaining_after;
    let event = ActionLockEvent {
        kind: classify(remaining_after),
        stage_before: Some(existing.stage),
        stage_after: if remaining_after == 0 {
            None
        } else {
            Some(lock.stage)
        },
        remaining_before,
        remaining_after,
    };
    Ok(ActionLockTransition {
        events: vec![event],
        lock: (remaining_after > 0).then_some(lock),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::BehaviorSourceId;
    use er_types::BehaviorUnitKind;
    use er_types::BehaviorUnitOrdinal;
    use er_types::ProvenanceHash;
    use er_types::SafeU53;
    use er_types::battle_ids::PokemonId;

    const LOCKED_MOVE_VALUE: u64 = 63;
    const OTHER_MOVE_VALUE: u64 = 307;
    const CHARGE_UNIT_HASH: &str =
        "a86bd927a3b327f01e489e00cb8fceee0faea64cfcec64108c443d86379df0fc";
    const RECHARGE_UNIT_HASH: &str =
        "7151f20f9485950058f78c75a67d09c625d548bf94912154db95d580cab12c63";

    fn actor() -> MechanicScope {
        MechanicScope::Pokemon {
            pokemon: PokemonId::try_from_u64(1).expect("fixture actor id"),
        }
    }

    fn move_id(value: u64) -> MoveId {
        MoveId::try_from_u64(value).expect("fixture move id")
    }

    fn behavior_unit(hash: &str) -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: SafeU53::new(LOCKED_MOVE_VALUE).expect("fixture move id"),
            },
            unit_kind: BehaviorUnitKind::MoveAttribute,
            ordinal: BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse(hash).expect("fixture hash"),
        }
    }

    fn charging_request(duration: u16) -> AcquireActionLock {
        AcquireActionLock {
            owner: actor(),
            locked_move_id: move_id(LOCKED_MOVE_VALUE),
            stage: ActionLockStage::Charging,
            duration_turns: duration,
            source_behavior_unit: behavior_unit(CHARGE_UNIT_HASH),
        }
    }

    fn recharging_request(duration: u16) -> AcquireActionLock {
        AcquireActionLock {
            owner: actor(),
            locked_move_id: move_id(LOCKED_MOVE_VALUE),
            stage: ActionLockStage::Recharging,
            duration_turns: duration,
            source_behavior_unit: behavior_unit(RECHARGE_UNIT_HASH),
        }
    }

    fn acquired(stage: ActionLockStage, duration: u16) -> ActionLockStateV2 {
        let request = match stage {
            ActionLockStage::Charging => charging_request(duration),
            ActionLockStage::Recharging => recharging_request(duration),
        };
        acquire_action_lock(None, &request)
            .expect("acquisition succeeds")
            .lock
            .expect("lock present")
    }

    fn continue_command(move_value: u64) -> LockedTurnCommand {
        LockedTurnCommand::ContinueLockedMove {
            move_id: move_id(move_value),
        }
    }

    #[test]
    fn two_turn_charge_acquires_then_continues_then_releases() {
        let acquisition =
            acquire_action_lock(None, &charging_request(2)).expect("first acquisition");
        assert_eq!(
            acquisition.events,
            vec![ActionLockEvent {
                kind: ActionLockEventKind::Acquired,
                stage_before: None,
                stage_after: Some(ActionLockStage::Charging),
                remaining_before: 0,
                remaining_after: 2,
            }]
        );
        let first = acquisition.lock.expect("live lock");
        assert_eq!(first.stage, ActionLockStage::Charging);
        assert_eq!(first.remaining_turns, 2);

        let continued = advance_locked_turn(&first, &continue_command(LOCKED_MOVE_VALUE))
            .expect("continuation accepted");
        assert_eq!(
            continued.events[0].kind,
            ActionLockEventKind::ChargeTurnConsumed
        );
        assert_eq!(continued.events[0].remaining_before, 2);
        assert_eq!(continued.events[0].remaining_after, 1);
        assert!(continued.lock.is_some());
        // The input lock is never mutated.
        assert_eq!(first.remaining_turns, 2);

        let final_turn = advance_locked_turn(
            continued.lock.as_ref().expect("still live"),
            &continue_command(LOCKED_MOVE_VALUE),
        )
        .expect("final continuation accepted");
        assert_eq!(
            final_turn.events[0].kind,
            ActionLockEventKind::ReleasedAfterFinalContinuation
        );
        assert_eq!(final_turn.events[0].stage_after, None);
        assert_eq!(final_turn.lock, None);
    }

    #[test]
    fn wrong_move_during_charge_is_rejected_and_input_unchanged() {
        let lock = acquired(ActionLockStage::Charging, 2);
        let before = lock.clone();
        let error = advance_locked_turn(&lock, &continue_command(OTHER_MOVE_VALUE))
            .expect_err("wrong move must fail");
        assert_eq!(
            error,
            ActionLockError::LockedMoveMismatch {
                expected: move_id(LOCKED_MOVE_VALUE),
                actual: move_id(OTHER_MOVE_VALUE),
            }
        );
        assert_eq!(lock, before);
    }

    #[test]
    fn recharge_skip_consumes_the_turn_and_releases() {
        let lock = acquired(ActionLockStage::Recharging, 1);
        assert_eq!(lock.stage, ActionLockStage::Recharging);

        let skipped = advance_locked_turn(&lock, &LockedTurnCommand::ForcedRechargeSkip)
            .expect("forced skip accepted");
        assert_eq!(
            skipped.events[0].kind,
            ActionLockEventKind::ReleasedAfterRechargeSkip
        );
        assert_eq!(skipped.events[0].remaining_before, 1);
        assert_eq!(skipped.events[0].remaining_after, 0);
        assert_eq!(skipped.lock, None);
    }

    #[test]
    fn competing_commands_are_rejected_in_both_stages() {
        let charging = acquired(ActionLockStage::Charging, 2);
        // A recharge-style skip cannot preempt a live charge.
        assert_eq!(
            advance_locked_turn(&charging, &LockedTurnCommand::ForcedRechargeSkip)
                .expect_err("skip cannot preempt a charge"),
            ActionLockError::CompetingCommandWhileLocked {
                stage: ActionLockStage::Charging,
                locked_move_id: move_id(LOCKED_MOVE_VALUE),
            }
        );
        assert_eq!(charging.remaining_turns, 2);

        let recharging = acquired(ActionLockStage::Recharging, 1);
        // Even the originally locked identity cannot bypass a recharge.
        assert_eq!(
            advance_locked_turn(&recharging, &continue_command(LOCKED_MOVE_VALUE))
                .expect_err("move cannot bypass a recharge"),
            ActionLockError::CompetingCommandWhileLocked {
                stage: ActionLockStage::Recharging,
                locked_move_id: move_id(LOCKED_MOVE_VALUE),
            }
        );
        assert_eq!(recharging.remaining_turns, 1);
    }

    #[test]
    fn duplicate_acquisition_is_rejected_over_any_live_lock() {
        let lock = acquired(ActionLockStage::Charging, 2);
        assert_eq!(
            acquire_action_lock(Some(&lock), &recharging_request(1))
                .expect_err("second acquisition over a live lock must fail"),
            ActionLockError::DuplicateAcquisition {
                locked_move_id: move_id(LOCKED_MOVE_VALUE),
            }
        );
        assert_eq!(lock.remaining_turns, 2);
    }

    #[test]
    fn faint_and_switch_cleanup_clear_the_whole_lock() {
        let lock = acquired(ActionLockStage::Charging, 2);

        let fainted = clear_lock_on_interruption(&lock, LockInterruption::ActorFainted)
            .expect("faint cleanup succeeds");
        assert_eq!(fainted.events[0].kind, ActionLockEventKind::ClearedOnFaint);
        assert_eq!(fainted.events[0].remaining_before, 2);
        assert_eq!(fainted.events[0].remaining_after, 0);
        assert_eq!(fainted.lock, None);

        let switched = clear_lock_on_interruption(&lock, LockInterruption::ActorSwitchedOut)
            .expect("switch cleanup succeeds");
        assert_eq!(
            switched.events[0].kind,
            ActionLockEventKind::ClearedOnSwitchOut
        );
        assert_eq!(switched.lock, None);
        assert_eq!(lock.remaining_turns, 2);
    }

    #[test]
    fn zero_duration_and_non_pokemon_owners_fail_closed() {
        assert_eq!(
            acquire_action_lock(None, &charging_request(0)).expect_err("zero duration must fail"),
            ActionLockError::ZeroDuration
        );
        let arena_request = AcquireActionLock {
            owner: MechanicScope::Battle,
            ..charging_request(2)
        };
        assert_eq!(
            acquire_action_lock(None, &arena_request).expect_err("non-pokemon owner must fail"),
            ActionLockError::OwnerNotAPokemonScope
        );
    }

    #[test]
    fn corrupt_canonical_lock_fails_closed_on_every_transition() {
        let mut lock = acquired(ActionLockStage::Charging, 2);
        lock.remaining_turns = 0;
        assert!(matches!(
            advance_locked_turn(&lock, &continue_command(LOCKED_MOVE_VALUE)),
            Err(ActionLockError::InvalidCanonicalState(
                ActionLockStateError::ZeroRemainingTurns
            ))
        ));
        assert!(matches!(
            clear_lock_on_interruption(&lock, LockInterruption::ActorFainted),
            Err(ActionLockError::InvalidCanonicalState(_))
        ));
    }
}
