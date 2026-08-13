mod snapshot {
    pub(crate) use er_kernel::snapshot::{
        PendingPresentationsSnapshotV1, PresentationOutcomeSnapshotV1, PresentationPlanSnapshotV1,
        SnapshotError,
    };
}

#[path = "../src/battle_presentation.rs"]
mod battle_presentation;

use std::error::Error;

use battle_presentation::{
    BattlePresentationError, BattlePresentationPlan, BattlePresentationSettlementReport,
    BattlePresentationState, M3_PRESENTATION_FAILED,
};
use er_types::battle_ids::BattlePresentationEventId;
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationBlockingPolicy,
    PresentationSettlementOutcome, PresentationSkipPolicy,
};
use er_types::{OperationId, SafeU53, SeatId};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> Result<SeatId, Box<dyn Error>> {
    Ok(SeatId::new(safe(value)?))
}

fn operation(value: &str) -> Result<OperationId, Box<dyn Error>> {
    Ok(OperationId::new(value)?)
}

fn event(
    operation_id: &OperationId,
    sequence: u64,
    policy: PresentationBlockingPolicy,
    skip_policy: PresentationSkipPolicy,
) -> Result<BattlePresentationEvent, Box<dyn Error>> {
    Ok(BattlePresentationEvent::new(
        BattlePresentationEventId::new(operation_id.clone(), safe(sequence)?),
        policy,
        skip_policy,
        BattlePresentationKind::BattleWon,
    ))
}

fn settle(
    state: &mut BattlePresentationState,
    endpoint: SeatId,
    event_id: &BattlePresentationEventId,
    outcome: PresentationSettlementOutcome,
) -> Result<BattlePresentationSettlementReport, Box<dyn Error>> {
    Ok(state.settle(endpoint, event_id.clone(), outcome)?)
}

#[test]
fn plan_identity_and_zero_based_order_are_checked_atomically() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/1/result")?;
    let first = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let second = event(
        &operation_id,
        1,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id.clone(), vec![first.clone(), second.clone()])?;

    let plan = state.plan().ok_or("plan was not installed")?;
    assert_eq!(plan.operation_id(), &operation_id);
    assert_eq!(plan.events(), &[first.clone(), second.clone()]);
    assert_eq!(state.plans().get(&operation_id), Some(plan));
    let snapshot = state.snapshot_v1()?;
    assert_eq!(snapshot.plans.len(), 1);
    assert_eq!(snapshot.plans[0].operation_id, operation_id);
    assert_eq!(state.blocking_ids().len(), 1);
    assert!(state.is_blocked());
    assert_eq!(state.live_count(), 2);
    state.validate()?;

    let before = state.clone();
    let wrong_operation = operation("battle/1/turn/2/result")?;
    let wrong_event = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    assert!(matches!(
        state.install_plan(wrong_operation, vec![wrong_event]),
        Err(BattlePresentationError::PlanOperationMismatch { .. })
    ));
    assert_eq!(state, before);

    let wrong_sequence = event(
        &operation_id,
        2,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    assert!(matches!(
        state.install_plan(operation_id, vec![first, wrong_sequence]),
        Err(BattlePresentationError::PlanSequenceMismatch { .. })
    ));
    assert_eq!(state, before);
    Ok(())
}

#[test]
fn concurrent_ordered_plans_settle_in_isolation() -> TestResult {
    let endpoint = seat(1)?;
    let first_operation = operation("battle/1/wave/1/turn/8/result")?;
    let first_blocking = event(
        &first_operation,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let first_nonblocking = event(
        &first_operation,
        1,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let second_operation = operation("battle/1/wave/1/turn/9/result")?;
    let second_blocking = event(
        &second_operation,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let second_nonblocking = event(
        &second_operation,
        1,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let first_blocking_id = first_blocking.event_id.clone();
    let first_nonblocking_id = first_nonblocking.event_id.clone();
    let second_blocking_id = second_blocking.event_id.clone();
    let second_nonblocking_id = second_nonblocking.event_id.clone();

    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(
        first_operation.clone(),
        vec![first_blocking, first_nonblocking],
    )?;
    state.install_plan(
        second_operation.clone(),
        vec![second_blocking, second_nonblocking],
    )?;

    assert_eq!(state.plan_count(), 2);
    assert_eq!(
        state.plan_operation_ids(),
        vec![first_operation.clone(), second_operation.clone()]
    );
    assert_eq!(
        state.plan().map(BattlePresentationPlan::operation_id),
        Some(&second_operation)
    );
    assert_eq!(state.live_count(), 4);
    assert_eq!(state.blocking_count(), 2);
    assert_eq!(state.outcome_count(), 0);
    assert_eq!(state.snapshot().plan_count(), 2);
    assert_eq!(state.snapshot().pending_ids(), state.pending_ids());
    assert_eq!(state.snapshot().blocking_ids(), state.blocking_ids());

    let second_nonblocking_report = settle(
        &mut state,
        endpoint,
        &second_nonblocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(!second_nonblocking_report.barrier_cleared());
    assert!(state.pending_ids().contains(&first_blocking_id));
    assert!(state.pending_ids().contains(&first_nonblocking_id));
    assert!(state.pending_ids().contains(&second_blocking_id));
    assert!(!state.pending_ids().contains(&second_nonblocking_id));
    assert!(state.blocking_ids().contains(&first_blocking_id));
    assert!(state.blocking_ids().contains(&second_blocking_id));
    assert_eq!(
        state.outcome(&second_nonblocking_id),
        Some(&PresentationSettlementOutcome::Settled)
    );
    assert!(state.plan_for(&first_operation).is_some());
    assert!(state.plan_for(&second_operation).is_some());

    let second_blocking_report = settle(
        &mut state,
        endpoint,
        &second_blocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(!second_blocking_report.barrier_cleared());
    assert!(state.is_blocked());
    assert!(state.blocking_ids().contains(&first_blocking_id));
    assert!(!state.blocking_ids().contains(&second_blocking_id));

    let first_blocking_report = settle(
        &mut state,
        endpoint,
        &first_blocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(first_blocking_report.barrier_cleared());
    assert!(!state.is_blocked());
    assert!(!state.blocking_ids().contains(&first_blocking_id));
    assert_eq!(state.live_count(), 1);
    assert!(state.pending_ids().contains(&first_nonblocking_id));
    assert_eq!(state.outcome_count(), 3);

    settle(
        &mut state,
        endpoint,
        &first_nonblocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert_eq!(state.live_count(), 0);
    assert_eq!(state.outcome_count(), 4);
    state.validate()?;
    Ok(())
}

#[test]
fn duplicate_operation_and_event_ids_are_rejected_atomically() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/wave/1/turn/10/result")?;
    let first_event = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id.clone(), vec![first_event.clone()])?;
    let before_duplicate_operation = state.clone();

    assert!(matches!(
        state.install_plan(operation_id, vec![first_event]),
        Err(BattlePresentationError::DuplicateOperationId { .. })
    ));
    assert_eq!(state, before_duplicate_operation);

    let duplicate_event_operation = operation("battle/1/wave/1/turn/11/result")?;
    let duplicate_event = event(
        &duplicate_event_operation,
        0,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let before_duplicate_event = state.clone();
    assert!(matches!(
        state.install_plan(
            duplicate_event_operation,
            vec![duplicate_event.clone(), duplicate_event],
        ),
        Err(BattlePresentationError::DuplicateEventId { .. })
    ));
    assert_eq!(state, before_duplicate_event);
    state.validate()?;
    Ok(())
}

#[test]
fn barriers_track_only_blocking_events_and_clear_on_final_success() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/2/result")?;
    let blocking = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let nonblocking = event(
        &operation_id,
        1,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let blocking_id = blocking.event_id.clone();
    let nonblocking_id = nonblocking.event_id.clone();
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id, vec![blocking, nonblocking])?;

    let nonblocking_report = settle(
        &mut state,
        endpoint,
        &nonblocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(!nonblocking_report.barrier_cleared());
    assert!(!nonblocking_report.is_idempotent());
    assert!(state.is_blocked());
    assert_eq!(state.live_count(), 1);
    assert_eq!(
        state.outcome(&nonblocking_id),
        Some(&PresentationSettlementOutcome::Settled)
    );

    let cleared_report = settle(
        &mut state,
        endpoint,
        &blocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(cleared_report.barrier_cleared());
    assert!(!state.is_blocked());
    assert_eq!(state.blocking_ids().len(), 0);
    assert_eq!(state.live_count(), 0);

    let duplicate = settle(
        &mut state,
        endpoint,
        &blocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(duplicate.is_idempotent());
    assert!(!duplicate.barrier_cleared());
    state.validate()?;
    Ok(())
}

#[test]
fn endpoint_and_identity_fences_leave_the_barrier_unchanged() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/3/result")?;
    let blocking = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Allowed,
    )?;
    let event_id = blocking.event_id.clone();
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id, vec![blocking])?;
    let before = state.clone();

    assert!(matches!(
        state.settle(
            seat(2)?,
            event_id.clone(),
            PresentationSettlementOutcome::Settled,
        ),
        Err(BattlePresentationError::WrongEndpoint { .. })
    ));
    assert!(matches!(
        state.settle(
            endpoint,
            BattlePresentationEventId::new(operation("unknown")?, safe(0)?),
            PresentationSettlementOutcome::Settled,
        ),
        Err(BattlePresentationError::UnknownEvent { .. })
    ));
    assert_eq!(state, before);
    Ok(())
}

#[test]
fn skip_authorization_and_failure_reason_are_rejected_without_mutation() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/4/result")?;
    let forbidden = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let allowed = event(
        &operation_id,
        1,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Allowed,
    )?;
    let forbidden_id = forbidden.event_id.clone();
    let allowed_id = allowed.event_id.clone();
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id, vec![forbidden, allowed])?;
    let before = state.clone();

    assert!(matches!(
        state.settle(
            endpoint,
            forbidden_id.clone(),
            PresentationSettlementOutcome::IntentionallySkipped,
        ),
        Err(BattlePresentationError::UnauthorizedSkip { .. })
    ));
    assert_eq!(state, before);

    let skipped = settle(
        &mut state,
        endpoint,
        &allowed_id,
        PresentationSettlementOutcome::IntentionallySkipped,
    )?;
    assert!(!skipped.barrier_cleared());
    assert_eq!(
        state.outcome(&allowed_id),
        Some(&PresentationSettlementOutcome::IntentionallySkipped)
    );

    let before_empty_failure = state.clone();
    assert!(matches!(
        state.settle(
            endpoint,
            forbidden_id,
            PresentationSettlementOutcome::Failed {
                reason: String::new(),
            },
        ),
        Err(BattlePresentationError::EmptyFailureReason)
    ));
    assert_eq!(state, before_empty_failure);
    Ok(())
}

#[test]
fn duplicate_outcomes_are_idempotent_but_conflicts_are_rejected() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/5/result")?;
    let event = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let event_id = event.event_id.clone();
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id, vec![event])?;

    settle(
        &mut state,
        endpoint,
        &event_id,
        PresentationSettlementOutcome::Settled,
    )?;
    let before_conflict = state.clone();
    assert!(matches!(
        state.settle(
            endpoint,
            event_id.clone(),
            PresentationSettlementOutcome::IntentionallySkipped,
        ),
        Err(BattlePresentationError::ConflictingDuplicate { .. })
    ));
    assert_eq!(state, before_conflict);

    let duplicate = settle(
        &mut state,
        endpoint,
        &event_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert!(duplicate.is_idempotent());
    assert_eq!(state.live_count(), 0);
    assert_eq!(state.outcomes().len(), 1);
    state.validate()?;
    Ok(())
}

#[test]
fn failed_blocking_event_retains_the_barrier_and_reports_terminal_reason() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/6/result")?;
    let event = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let event_id = event.event_id.clone();
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id, vec![event])?;
    let failure = PresentationSettlementOutcome::failed("renderer lost the event")?;

    let report = settle(&mut state, endpoint, &event_id, failure.clone())?;
    assert!(!report.barrier_cleared());
    assert_eq!(report.terminal_reason(), Some(M3_PRESENTATION_FAILED));
    assert!(!report.is_idempotent());
    assert!(state.is_blocked());
    assert_eq!(state.blocking_ids().len(), 1);
    assert_eq!(state.live_count(), 0);
    assert_eq!(state.outcome(&event_id), Some(&failure));
    state.validate()?;

    let duplicate = settle(&mut state, endpoint, &event_id, failure)?;
    assert!(duplicate.is_idempotent());
    assert!(!duplicate.barrier_cleared());
    assert_eq!(duplicate.terminal_reason(), Some(M3_PRESENTATION_FAILED));
    assert!(state.is_blocked());
    Ok(())
}

#[test]
fn dispose_is_idempotent_and_drops_live_events() -> TestResult {
    let endpoint = seat(1)?;
    let operation_id = operation("battle/1/turn/7/result")?;
    let blocking = event(
        &operation_id,
        0,
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
    )?;
    let nonblocking = event(
        &operation_id,
        1,
        PresentationBlockingPolicy::NonBlocking,
        PresentationSkipPolicy::Allowed,
    )?;
    let blocking_id = blocking.event_id.clone();
    let mut state = BattlePresentationState::new(endpoint);
    state.install_plan(operation_id, vec![blocking, nonblocking])?;
    settle(
        &mut state,
        endpoint,
        &blocking_id,
        PresentationSettlementOutcome::Settled,
    )?;
    assert_eq!(state.live_count(), 1);

    state.dispose();
    state.dispose();
    assert!(state.is_disposed());
    assert!(state.plan().is_none());
    assert_eq!(state.live_count(), 0);
    assert!(!state.is_blocked());
    assert_eq!(
        state.outcome(&blocking_id),
        Some(&PresentationSettlementOutcome::Settled)
    );
    assert!(matches!(
        state.install_plan(operation("after-dispose")?, Vec::new()),
        Err(BattlePresentationError::Disposed)
    ));
    state.validate()?;
    Ok(())
}
