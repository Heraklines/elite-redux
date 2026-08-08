use er_protocol::{
    ControlProjectionOutcome, DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS, DEFAULT_RECOVERY_PACING_MS,
    DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS, KernelScheduler, RecoveryAction, RecoveryBundleValidation,
    RecoveryError, RecoveryFence, RecoveryFenceState, RecoveryFenceView,
    RecoveryFrontierStagingOutcome, RecoveryLiveState, RecoveryMaterialOutcome, RecoveryPhase,
    RecoveryTransaction, RecoveryTransactionConfig, RecoveryValidationContext, ScheduledTimer,
    SchedulerCommand, control_id_of, validate_recovery_bundle,
};
use er_types::{
    AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, FrameContext, Material, MembershipRevision,
    NextControl, OperationId, RecoveryAppliedProof, RecoveryBundle, Revision, RunId, SafeU53,
    SeatId, SessionId, TimeClass, TimerId, TimerOwner,
};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value must be inside SafeU53")
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("test operation id must be valid")
}

fn authority_context() -> FrameContext {
    FrameContext {
        session_id: SessionId::new("session-1").expect("session id"),
        run_id: RunId::new("run-1").expect("run id"),
        session_epoch: safe(3),
        seat_map_id: "seat-map-1".to_owned(),
        membership_revision: MembershipRevision::new(safe(2)),
        sender_seat_id: SeatId::new(safe(0)),
        authority_seat_id: SeatId::new(safe(0)),
        connection_generation: ConnectionGeneration::new(safe(1)),
    }
}

fn replica_context() -> FrameContext {
    FrameContext {
        sender_seat_id: SeatId::new(safe(1)),
        connection_generation: ConnectionGeneration::new(safe(2)),
        ..authority_context()
    }
}

fn command_control(turn: u64) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(3),
        wave: safe(4),
        turn: safe(turn),
        commands: vec![CommandControlTarget {
            owner_seat_id: SeatId::new(safe(0)),
            pokemon_id: safe(7),
            field_index: safe(0),
        }],
    })
}

fn entry(context: &FrameContext, revision: u64, control: NextControl) -> AuthorityEntry {
    AuthorityEntry {
        context: context.clone(),
        revision: Revision::new(safe(revision)),
        operation_id: operation(&format!("operation-{revision}")),
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: format!("digest-{revision}"),
            payload: serde_json::Value::Null,
        },
        next_control: control,
        subsumes: Vec::new(),
    }
}

fn bundle(captured: u64, frontier: u64) -> RecoveryBundle {
    let context = authority_context();
    let control = command_control(1);
    let mut required_tail = Vec::new();
    if frontier > captured {
        for revision in (captured + 1)..=frontier {
            required_tail.push(entry(&context, revision, control.clone()));
        }
    } else if frontier > 0 {
        required_tail.push(entry(&context, frontier, control.clone()));
    }
    RecoveryBundle {
        request_id: "recovery-1".to_owned(),
        context,
        material: Material {
            digest: "material-digest".to_owned(),
            payload: serde_json::json!({"hp": 42}),
        },
        frontier: Revision::new(safe(frontier)),
        frontier_operation_id: required_tail.last().map(|entry| entry.operation_id.clone()),
        membership_revision: MembershipRevision::new(safe(2)),
        next_control: required_tail.last().map(|entry| entry.next_control.clone()),
        required_tail,
    }
}

fn frontier(revision: u64) -> AuthorityFrontier {
    AuthorityFrontier {
        received: Revision::new(safe(revision)),
        material: Revision::new(safe(revision)),
        control: Revision::new(safe(revision)),
    }
}

fn staged_frontier(revision: u64) -> AuthorityFrontier {
    AuthorityFrontier {
        received: Revision::new(safe(revision)),
        material: Revision::new(safe(revision)),
        control: Revision::new(safe(revision - 1)),
    }
}

fn live(revision: u64) -> RecoveryLiveState {
    RecoveryLiveState {
        frontier: frontier(revision),
        context: replica_context(),
    }
}

fn live_with_frontier(frontier: AuthorityFrontier) -> RecoveryLiveState {
    RecoveryLiveState {
        frontier,
        context: replica_context(),
    }
}

fn transaction() -> RecoveryTransaction {
    transaction_with_owner("recovery-owner".to_owned())
        .expect("test recovery transaction config must be valid")
}

fn transaction_with_owner(timer_owner_id: String) -> Result<RecoveryTransaction, RecoveryError> {
    RecoveryTransaction::new(RecoveryTransactionConfig {
        local_context: replica_context(),
        request_timeout_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
        control_timeout_ms: safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS),
        pacing_ms: safe(DEFAULT_RECOVERY_PACING_MS),
        timer_owner_id,
    })
}

fn scheduled(actions: &[RecoveryAction]) -> ScheduledTimer {
    actions
        .iter()
        .find_map(|action| match action {
            RecoveryAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            } => Some(timer.clone()),
            _ => None,
        })
        .expect("expected a scheduler registration")
}

fn has_cancel(actions: &[RecoveryAction], timer_id: TimerId) -> bool {
    actions.iter().any(|action| {
        matches!(
            action,
            RecoveryAction::Scheduler {
                command: SchedulerCommand::Cancel { timer_id: id, .. }
            } if *id == timer_id
        )
    })
}

fn terminalize_count(actions: &[RecoveryAction]) -> usize {
    actions
        .iter()
        .filter(|action| matches!(action, RecoveryAction::Terminalize { .. }))
        .count()
}

fn assert_no_live_resources(transaction: &RecoveryTransaction, scheduler: &KernelScheduler) {
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
    assert_eq!(scheduler.pending_timer_count(), safe(0));
}

fn expected_terminal_actions(
    view: RecoveryFenceView,
    cancelled: &[ScheduledTimer],
    reason: &str,
) -> Vec<RecoveryAction> {
    let mut actions = vec![RecoveryAction::FenceChanged { view }];
    actions.extend(cancelled.iter().map(|timer| RecoveryAction::Scheduler {
        command: SchedulerCommand::Cancel {
            endpoint: timer.endpoint,
            timer_id: timer.timer_id,
        },
    }));
    actions.push(RecoveryAction::Terminalize {
        reason: reason.to_owned(),
    });
    actions
}

fn open_fence_view() -> RecoveryFenceView {
    RecoveryFenceView {
        state: RecoveryFenceState::Open,
        command_admission_frozen: false,
        control_surface_start_frozen: false,
        progression_frozen: false,
        materialization_frozen: false,
        authority_wait_creation_frozen: false,
        terminal_reason: None,
    }
}

fn assert_exact_terminal_actions(
    transaction: &RecoveryTransaction,
    scheduler: &KernelScheduler,
    actions: &[RecoveryAction],
    cancelled: &[ScheduledTimer],
    reason: &str,
) {
    let terminal_view = actions
        .iter()
        .find_map(|action| match action {
            RecoveryAction::FenceChanged { view } if view.state == RecoveryFenceState::Terminal => {
                Some(view.clone())
            }
            _ => None,
        })
        .expect("terminal action vector must begin with a terminal fence change");
    assert_eq!(
        actions,
        expected_terminal_actions(terminal_view, cancelled, reason)
    );
    assert_eq!(terminalize_count(actions), 1);
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert_no_live_resources(transaction, scheduler);
}

fn prepare_control_pending() -> (RecoveryTransaction, KernelScheduler) {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    transaction
        .accept_bundle(bundle(10, 12), live(10), &mut scheduler)
        .expect("accept");
    transaction
        .material_result(RecoveryMaterialOutcome::Applied, live(10), &mut scheduler)
        .expect("material");
    transaction
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("stage");
    (transaction, scheduler)
}

fn prepare_validated() -> (RecoveryTransaction, KernelScheduler) {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    transaction
        .accept_bundle(bundle(10, 12), live(10), &mut scheduler)
        .expect("accept");
    (transaction, scheduler)
}

fn prepare_material_pending() -> (RecoveryTransaction, KernelScheduler) {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    transaction
        .accept_bundle(bundle(10, 12), live(10), &mut scheduler)
        .expect("accept");
    transaction
        .material_result(RecoveryMaterialOutcome::Applied, live(10), &mut scheduler)
        .expect("material");
    (transaction, scheduler)
}

#[test]
fn fence_is_one_shot_and_only_the_stated_control_window_unfreezes_surface_start() {
    let mut fence = RecoveryFence::new();
    assert_eq!(fence.state(), RecoveryFenceState::Open);
    assert!(!fence.is_command_admission_frozen());
    assert!(fence.acquire());
    assert!(!fence.acquire());
    assert!(fence.is_command_admission_frozen());
    assert!(fence.is_progression_frozen());
    assert!(fence.is_materialization_frozen());
    assert!(fence.is_control_surface_start_frozen());
    assert!(fence.is_authority_wait_creation_frozen());

    assert!(fence.allow_control_projection());
    assert!(!fence.allow_control_projection());
    assert!(!fence.is_control_surface_start_frozen());
    assert!(!fence.is_authority_wait_creation_frozen());

    fence.release();
    assert_eq!(fence.state(), RecoveryFenceState::Open);
    fence.terminalize("first terminal reason".to_owned());
    fence.terminalize("second terminal reason".to_owned());
    assert_eq!(fence.state(), RecoveryFenceState::Terminal);
    assert_eq!(fence.terminal_reason(), Some("first terminal reason"));
}

#[test]
fn recovery_validation_preserves_zero_equal_and_dense_shapes_and_exact_bindings() {
    let context = RecoveryValidationContext {
        expected_request_id: "recovery-1".to_owned(),
        live_context: replica_context(),
        captured_frontier: Revision::new(safe(10)),
    };
    assert!(matches!(
        validate_recovery_bundle(&context, &bundle(10, 12)),
        RecoveryBundleValidation::Valid { .. }
    ));
    assert!(matches!(
        validate_recovery_bundle(
            &RecoveryValidationContext {
                captured_frontier: Revision::ZERO,
                ..context.clone()
            },
            &bundle(0, 0)
        ),
        RecoveryBundleValidation::Valid { .. }
    ));
    assert!(matches!(
        validate_recovery_bundle(&context, &bundle(10, 8)),
        RecoveryBundleValidation::Stale { .. }
    ));

    let mut wrong_operation = bundle(10, 12);
    wrong_operation.frontier_operation_id = Some(operation("not-the-tail"));
    assert!(matches!(
        validate_recovery_bundle(&context, &wrong_operation),
        RecoveryBundleValidation::Mismatch { issues } if !issues.is_empty()
    ));

    let mut wrong_control = bundle(10, 12);
    wrong_control.next_control = Some(command_control(2));
    assert!(matches!(
        validate_recovery_bundle(&context, &wrong_control),
        RecoveryBundleValidation::Mismatch { issues } if !issues.is_empty()
    ));
}

#[test]
fn recovery_validation_applies_distinct_operation_and_material_digest_rules() {
    let context = RecoveryValidationContext {
        expected_request_id: "recovery-1".to_owned(),
        live_context: replica_context(),
        captured_frontier: Revision::new(safe(10)),
    };

    let mut control_character_operation = bundle(10, 12);
    control_character_operation.required_tail[0].operation_id = operation("operation-\u{0000}");
    assert!(matches!(
        validate_recovery_bundle(&context, &control_character_operation),
        RecoveryBundleValidation::Mismatch { .. }
    ));

    let mut control_character_digest = bundle(10, 12);
    control_character_digest.material.digest = "digest-\u{0000}".to_owned();
    assert!(matches!(
        validate_recovery_bundle(&context, &control_character_digest),
        RecoveryBundleValidation::Valid { .. }
    ));

    let mut overlong_digest = bundle(10, 12);
    overlong_digest.material.digest = "\u{1f642}".repeat(129);
    assert!(matches!(
        validate_recovery_bundle(&context, &overlong_digest),
        RecoveryBundleValidation::Mismatch { .. }
    ));
}

#[test]
fn recovery_timer_owner_uses_canonical_validation_for_opaque_values() {
    assert!(matches!(
        transaction_with_owner(String::new()),
        Err(RecoveryError::InvalidPhase { phase: None })
    ));

    let opaque_owner = format!("{}\u{0000}owner", "opaque".repeat(128));
    let mut transaction = transaction_with_owner(opaque_owner.clone()).expect("opaque owner");
    let mut scheduler = KernelScheduler::new();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("opaque owner start");
    let timer = scheduled(&actions);
    assert_eq!(timer.owner.owner_id, opaque_owner);
    assert!(!timer.owner.address.is_empty());
    assert!(!timer.owner.reason.is_empty());
}

#[test]
fn staged_frontier_is_exact_and_rejects_stale_or_advanced_live_state() {
    let (mut positive, mut positive_scheduler) = prepare_material_pending();
    let actions = positive
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            live_with_frontier(staged_frontier(12)),
            &mut positive_scheduler,
        )
        .expect("normal 10 to 12 staging");
    assert!(matches!(
        actions.as_slice(),
        [
            RecoveryAction::FenceChanged { view },
            RecoveryAction::Scheduler {
                command: SchedulerCommand::Schedule { timer: _timer }
            },
            RecoveryAction::ProjectControl {
                revision,
                expected_control_id,
                control,
            }
        ] if view.state == RecoveryFenceState::Held
            && !view.control_surface_start_frozen
            && *revision == Revision::new(safe(12))
            && *expected_control_id == control_id_of(control)
    ));
    assert_eq!(positive.phase(), Some(RecoveryPhase::FrontierInstalled));
    assert_eq!(positive_scheduler.pending_timer_count(), safe(1));

    let (mut stale, mut stale_scheduler) = prepare_material_pending();
    let stale_actions = stale
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            live(10),
            &mut stale_scheduler,
        )
        .expect("stale staged frontier terminalizes");
    assert_exact_terminal_actions(
        &stale,
        &stale_scheduler,
        &stale_actions,
        &[],
        &format!(
            "recovery staged frontier changed under the fence (expected {:?}, live {:?})",
            staged_frontier(12),
            live(10).frontier
        ),
    );

    let (mut advanced, mut advanced_scheduler) = prepare_material_pending();
    let advanced_live = live_with_frontier(AuthorityFrontier {
        received: Revision::new(safe(13)),
        material: Revision::new(safe(12)),
        control: Revision::new(safe(11)),
    });
    let advanced_frontier = advanced_live.frontier;
    let advanced_actions = advanced
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            advanced_live,
            &mut advanced_scheduler,
        )
        .expect("advanced staged frontier terminalizes");
    assert_exact_terminal_actions(
        &advanced,
        &advanced_scheduler,
        &advanced_actions,
        &[],
        &format!(
            "recovery staged frontier changed under the fence (expected {:?}, live {:?})",
            staged_frontier(12),
            advanced_frontier
        ),
    );
}

#[test]
fn start_fences_before_request_and_uses_the_scheduler_allocator() {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");

    let timer = scheduled(&actions);
    assert_eq!(timer.timer_id, TimerId::ZERO);
    assert_eq!(scheduler.timer(timer.timer_id), Some(&timer));
    assert!(matches!(
        actions.as_slice(),
        [
            RecoveryAction::FenceChanged { .. },
            RecoveryAction::Scheduler {
                command: SchedulerCommand::Schedule { .. }
            },
            RecoveryAction::SendRequest { .. }
        ]
    ));
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Requested));
    assert_eq!(
        transaction.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Held)
    );
}

#[test]
fn reentry_is_rejected_as_fence_held_without_superseding_any_state() {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("first recovery start");

    let before_phase = transaction.phase();
    let before_diagnostics = transaction.diagnostics();
    let before_fence = transaction.fence_view();
    let before_timers = scheduler.live_timers();
    let before_scheduler = format!("{scheduler:?}");
    let result = transaction.start(
        "recovery-2".to_owned(),
        frontier(10),
        "superseding rejoin".to_owned(),
        &mut scheduler,
    );

    assert_eq!(result, Err(RecoveryError::FenceHeld));
    assert_eq!(transaction.phase(), before_phase);
    assert_eq!(transaction.diagnostics(), before_diagnostics);
    assert_eq!(transaction.fence_view(), before_fence);
    assert_eq!(scheduler.live_timers(), before_timers);
    assert_eq!(format!("{scheduler:?}"), before_scheduler);
}

#[test]
fn allocator_ids_are_composed_with_other_scheduler_owners_and_metadata_is_exact() {
    let mut scheduler = KernelScheduler::new();
    let foreign = scheduler
        .schedule(
            SeatId::new(safe(9)),
            TimerOwner {
                owner_id: "other-owner".to_owned(),
                address: "other/address".to_owned(),
                reason: "other reason".to_owned(),
            },
            safe(5),
            TimeClass::Absolute,
        )
        .expect("foreign timer");
    let foreign_timer = scheduler
        .timer(TimerId::new(safe(0)))
        .cloned()
        .expect("foreign timer registration");
    assert_eq!(
        foreign,
        SchedulerCommand::Schedule {
            timer: foreign_timer.clone(),
        }
    );

    let mut transaction = transaction();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let request_timer = scheduled(&actions);
    assert_eq!(request_timer.timer_id, TimerId::new(safe(1)));
    assert_eq!(request_timer.endpoint, SeatId::new(safe(1)));
    assert_eq!(request_timer.time_class, TimeClass::Recovery);
    assert_eq!(
        request_timer.owner.address,
        "recovery/session-1/run-1/recovery-1"
    );
    assert_ne!(request_timer.timer_id, foreign_timer.timer_id);

    let accepted = transaction
        .accept_bundle(bundle(10, 12), live(10), &mut scheduler)
        .expect("accept");
    assert!(has_cancel(&accepted, request_timer.timer_id));
    assert!(scheduler.timer(request_timer.timer_id).is_none());

    let staged = transaction
        .material_result(RecoveryMaterialOutcome::Applied, live(10), &mut scheduler)
        .expect("material")
        .len();
    assert_eq!(staged, 1);
    let staged = transaction
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("stage");
    let control_timer = scheduled(&staged);
    assert_eq!(control_timer.timer_id, TimerId::new(safe(2)));
    assert_eq!(
        control_timer.owner.address,
        "recovery-control/session-1/run-1/recovery-1"
    );
    assert!(scheduler.timer(foreign_timer.timer_id).is_some());
}

#[test]
fn material_success_stages_the_exact_full_entry_before_staged_signal_and_control() {
    let (mut transaction, mut scheduler) = prepare_validated();
    let expected_entry = entry(&authority_context(), 12, command_control(1));
    let mut trace = vec!["material-success"];
    let material_actions = transaction
        .material_result(RecoveryMaterialOutcome::Applied, live(10), &mut scheduler)
        .expect("material success");
    assert_eq!(
        material_actions,
        vec![RecoveryAction::StageRecoveredFrontier {
            entry: expected_entry.clone(),
        }]
    );
    trace.push("full-entry-stage");
    assert_eq!(transaction.phase(), Some(RecoveryPhase::MaterialApplied));
    assert!(scheduler.live_timers().is_empty());
    assert!(transaction.diagnostics().timer_ids.is_empty());

    let staged_actions = transaction
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: expected_entry.revision,
            },
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("full entry staged");
    trace.push("staged-signal");
    assert!(matches!(
        staged_actions.as_slice(),
        [
            RecoveryAction::FenceChanged { view },
            RecoveryAction::Scheduler {
                command: SchedulerCommand::Schedule { timer }
            },
            RecoveryAction::ProjectControl {
                revision,
                control,
                expected_control_id,
            }
        ] if view.state == RecoveryFenceState::Held
            && !view.control_surface_start_frozen
            && *revision == expected_entry.revision
            && timer.timer_id == TimerId::new(safe(1))
            && timer.time_class == TimeClass::Recovery
            && *control == expected_entry.next_control
            && *expected_control_id == control_id_of(&expected_entry.next_control)
    ));
    trace.push("control");
    assert_eq!(
        trace,
        vec![
            "material-success",
            "full-entry-stage",
            "staged-signal",
            "control"
        ]
    );
    assert_eq!(transaction.phase(), Some(RecoveryPhase::FrontierInstalled));
    assert_eq!(scheduler.live_timers().len(), 1);
}

#[test]
fn changed_live_state_terminalizes_at_every_deferred_boundary() {
    let mut accept = transaction();
    let mut scheduler = KernelScheduler::new();
    let start_actions = accept
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let request_timer = scheduled(&start_actions);
    let changed_frontier = AuthorityFrontier {
        received: Revision::new(safe(11)),
        ..frontier(10)
    };
    let actions = accept
        .accept_bundle(
            bundle(10, 12),
            live_with_frontier(changed_frontier),
            &mut scheduler,
        )
        .expect("changed accept state terminalizes");
    assert_exact_terminal_actions(
        &accept,
        &scheduler,
        &actions,
        &[request_timer],
        &format!(
            "recovery live frontier changed under the fence (captured {:?}, live {:?})",
            frontier(10),
            changed_frontier
        ),
    );

    let mut material = transaction();
    let mut scheduler = KernelScheduler::new();
    material
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    material
        .accept_bundle(bundle(10, 12), live(10), &mut scheduler)
        .expect("accept");
    let changed_context = FrameContext {
        connection_generation: ConnectionGeneration::new(safe(3)),
        ..replica_context()
    };
    let actions = material
        .material_result(
            RecoveryMaterialOutcome::Applied,
            RecoveryLiveState {
                frontier: frontier(10),
                context: changed_context,
            },
            &mut scheduler,
        )
        .expect("changed material state terminalizes");
    assert_exact_terminal_actions(
        &material,
        &scheduler,
        &actions,
        &[],
        "recovery live context changed under the fence",
    );

    let (mut stage, mut scheduler) = prepare_material_pending();
    let actions = stage
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            live(10),
            &mut scheduler,
        )
        .expect("changed stage state terminalizes");
    assert_exact_terminal_actions(
        &stage,
        &scheduler,
        &actions,
        &[],
        &format!(
            "recovery staged frontier changed under the fence (expected {:?}, live {:?})",
            staged_frontier(12),
            live(10).frontier
        ),
    );

    let (mut control, mut scheduler) = prepare_control_pending();
    let changed_context = FrameContext {
        membership_revision: MembershipRevision::new(safe(3)),
        ..replica_context()
    };
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let actions = control
        .control_result(
            ControlProjectionOutcome::Deferred,
            RecoveryLiveState {
                frontier: staged_frontier(12),
                context: changed_context,
            },
            &mut scheduler,
        )
        .expect("changed control state terminalizes");
    assert_exact_terminal_actions(
        &control,
        &scheduler,
        &actions,
        &[control_timer],
        "recovery live context changed under the fence",
    );

    let (mut pacing, mut scheduler) = prepare_control_pending();
    let deferred = pacing
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing");
    let pacing_timer = scheduled(&deferred);
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let fired = scheduler
        .fired(pacing_timer.timer_id)
        .expect("scheduler removes pacing before callback");
    let changed_context = FrameContext {
        connection_generation: ConnectionGeneration::new(safe(3)),
        ..replica_context()
    };
    let actions = pacing
        .timer_fired(
            fired,
            RecoveryLiveState {
                frontier: staged_frontier(12),
                context: changed_context,
            },
            &mut scheduler,
        )
        .expect("changed pacing state terminalizes");
    assert_exact_terminal_actions(
        &pacing,
        &scheduler,
        &actions,
        &[control_timer],
        "recovery live context changed under the fence",
    );
}

#[test]
fn material_deferred_and_rejected_outcomes_terminalize_with_exact_actions() {
    let (mut deferred, mut deferred_scheduler) = prepare_validated();
    let deferred_actions = deferred
        .material_result(
            RecoveryMaterialOutcome::Deferred,
            live(10),
            &mut deferred_scheduler,
        )
        .expect("material deferred outcome terminalizes");
    assert_exact_terminal_actions(
        &deferred,
        &deferred_scheduler,
        &deferred_actions,
        &[],
        "recovery material application deferred",
    );

    let (mut rejected, mut rejected_scheduler) = prepare_validated();
    let rejected_actions = rejected
        .material_result(
            RecoveryMaterialOutcome::Rejected,
            live(10),
            &mut rejected_scheduler,
        )
        .expect("material rejected outcome terminalizes");
    assert_exact_terminal_actions(
        &rejected,
        &rejected_scheduler,
        &rejected_actions,
        &[],
        "recovery material application rejected",
    );
}

#[test]
fn control_rejection_terminalizes_and_cancels_the_live_control_timer_exactly() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Rejected {
                reason: "replica rejected control".to_owned(),
            },
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("control rejection terminalizes");
    assert_exact_terminal_actions(
        &transaction,
        &scheduler,
        &actions,
        &[control_timer],
        "control projection rejected: replica rejected control",
    );
}

#[test]
fn control_timeout_callback_is_distinct_from_request_timeout_and_cleans_all_resources() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let fired = scheduler
        .fired(control_timer.timer_id)
        .expect("scheduler removes control timer before callback");
    let actions = transaction
        .timer_fired(
            fired,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("control timeout terminalizes");
    assert_exact_terminal_actions(
        &transaction,
        &scheduler,
        &actions,
        &[],
        "recovery control-install timeout exceeded",
    );
    assert!(!actions.iter().any(|action| matches!(
        action,
        RecoveryAction::Terminalize { reason }
            if reason == "recovery request timeout exceeded"
    )));
}

#[test]
fn timer_callback_requires_exact_removed_registration_and_duplicate_callbacks_are_rejected() {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let timer = scheduled(&actions);

    let mut wrong = timer.clone();
    wrong.delay_ms = safe(7);
    assert!(matches!(
        transaction.timer_fired(wrong, live(10), &mut scheduler),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::Requested)
        })
    ));
    assert_eq!(transaction.diagnostics().timer_ids.len(), 1);
    assert!(scheduler.timer(timer.timer_id).is_some());

    let fired = scheduler
        .fired(timer.timer_id)
        .expect("scheduler removes exact timer before callback");
    let mut stale = fired.clone();
    stale.delay_ms = safe(7);
    assert!(matches!(
        transaction.timer_fired(stale, live(10), &mut scheduler),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::Requested)
        })
    ));
    assert_eq!(transaction.diagnostics().timer_ids.len(), 1);
    assert!(scheduler.live_timers().is_empty());
    let timeout = transaction
        .timer_fired(fired.clone(), live(10), &mut scheduler)
        .expect("exact callback");
    assert_exact_terminal_actions(
        &transaction,
        &scheduler,
        &timeout,
        &[],
        "recovery request timeout exceeded",
    );
    assert!(matches!(
        transaction.timer_fired(fired, live(10), &mut scheduler),
        Err(RecoveryError::Terminalized { .. })
    ));
    assert_no_live_resources(&transaction, &scheduler);
}

#[test]
fn timer_callback_rejects_a_live_registration_until_scheduler_removes_it() {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let timer = scheduled(&actions);

    assert!(matches!(
        transaction.timer_fired(timer.clone(), live(10), &mut scheduler),
        Err(RecoveryError::InvalidPhase { .. })
    ));
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Requested));
    assert_eq!(transaction.diagnostics().timer_ids.len(), 1);
    assert_eq!(scheduler.timer(timer.timer_id), Some(&timer));
}

#[test]
fn removed_registration_with_wrong_owner_fails_atomically() {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let removed = scheduler
        .fired(scheduled(&actions).timer_id)
        .expect("scheduler removes request before callback");
    let mut wrong_owner = removed.clone();
    wrong_owner.owner.reason = "wrong recovery reason".to_owned();

    let result = transaction.timer_fired(wrong_owner, live(10), &mut scheduler);
    assert!(matches!(
        result,
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::Requested)
        })
    ));
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Requested));
    assert_eq!(transaction.diagnostics().timer_ids.len(), 1);
    assert!(scheduler.live_timers().is_empty());

    let abort = transaction.abort("wrong removed timer".to_owned(), &mut scheduler);
    assert_exact_terminal_actions(&transaction, &scheduler, &abort, &[], "wrong removed timer");
}

#[test]
fn deferred_retry_terminalizes_when_pacing_registration_is_missing_or_disposed() {
    let (mut missing, mut missing_scheduler) = prepare_control_pending();
    let control_timer = missing_scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let pacing = missing
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut missing_scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&pacing);
    assert!(missing_scheduler.cancel(pacing_timer.timer_id).is_some());

    let missing_actions = missing
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut missing_scheduler,
        )
        .expect("missing pacing registration terminalizes");
    assert_exact_terminal_actions(
        &missing,
        &missing_scheduler,
        &missing_actions,
        &[control_timer],
        "recovery pacing timer registration disappeared before deferred retry",
    );

    let (mut disposed, mut disposed_scheduler) = prepare_control_pending();
    let _pacing = disposed
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut disposed_scheduler,
        )
        .expect("pacing allocation before disposal");
    disposed_scheduler.dispose();

    let disposed_actions = disposed
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut disposed_scheduler,
        )
        .expect("disposed scheduler terminalizes");
    assert_exact_terminal_actions(
        &disposed,
        &disposed_scheduler,
        &disposed_actions,
        &[],
        "recovery control timer registration disappeared before deferred retry",
    );
}

#[test]
fn deferred_retry_terminalizes_when_control_registration_is_missing_while_pacing_is_live() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    assert!(scheduler.cancel(control_timer.timer_id).is_some());

    let terminal = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("missing control registration terminalizes");
    assert_exact_terminal_actions(
        &transaction,
        &scheduler,
        &terminal,
        &[pacing_timer],
        "recovery control timer registration disappeared before deferred retry",
    );

    let phase = transaction.phase();
    let diagnostics = transaction.diagnostics();
    let repeated = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect_err("repeated deferred callback must remain terminalized");
    assert!(matches!(repeated, RecoveryError::Terminalized { .. }));
    assert_eq!(transaction.phase(), phase);
    assert_eq!(transaction.diagnostics(), diagnostics);
    assert_no_live_resources(&transaction, &scheduler);
}

#[test]
fn pacing_callback_terminalizes_when_control_registration_is_missing() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    let fired = scheduler
        .fired(pacing_timer.timer_id)
        .expect("pacing timer removed before callback");
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    assert!(scheduler.cancel(control_timer.timer_id).is_some());

    let terminal = transaction
        .timer_fired(
            fired.clone(),
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("missing control registration terminalizes pacing callback");
    assert_exact_terminal_actions(
        &transaction,
        &scheduler,
        &terminal,
        &[],
        "recovery control timer registration disappeared before pacing retry",
    );

    let phase = transaction.phase();
    let diagnostics = transaction.diagnostics();
    let repeated = transaction
        .timer_fired(
            fired,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect_err("repeated pacing callback must remain terminalized");
    assert!(matches!(repeated, RecoveryError::Terminalized { .. }));
    assert_eq!(transaction.phase(), phase);
    assert_eq!(transaction.diagnostics(), diagnostics);
    assert_no_live_resources(&transaction, &scheduler);
}

#[test]
fn wrong_control_timer_metadata_is_rejected_while_pacing_remains_live() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    let mut wrong_control = control_timer.clone();
    wrong_control.owner.reason = "wrong control registration".to_owned();

    let phase = transaction.phase();
    let diagnostics = transaction.diagnostics();
    let result = transaction.timer_fired(
        wrong_control,
        live_with_frontier(staged_frontier(12)),
        &mut scheduler,
    );
    assert!(matches!(
        result,
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::FrontierInstalled)
        })
    ));
    assert_eq!(transaction.phase(), phase);
    assert_eq!(transaction.diagnostics(), diagnostics);
    assert_eq!(
        scheduler.timer(control_timer.timer_id),
        Some(&control_timer)
    );
    assert_eq!(scheduler.timer(pacing_timer.timer_id), Some(&pacing_timer));
    assert_eq!(scheduler.pending_timer_count(), safe(2));
}

#[test]
fn happy_path_uses_removed_pacing_timer_and_releases_after_exact_control_proof() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("deferred control");
    let pacing_timer = scheduled(&deferred);
    assert_eq!(pacing_timer.delay_ms, safe(DEFAULT_RECOVERY_PACING_MS));
    let duplicate_deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("duplicate deferred control");
    assert!(duplicate_deferred.is_empty());
    assert_eq!(transaction.diagnostics().timer_ids.len(), 2);
    assert_eq!(scheduler.pending_timer_count(), safe(2));

    let fired = scheduler
        .fired(pacing_timer.timer_id)
        .expect("scheduler removes pacing before callback");
    let retry = transaction
        .timer_fired(
            fired,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing callback");
    assert_eq!(
        retry,
        vec![RecoveryAction::ProjectControl {
            revision: Revision::new(safe(12)),
            control: command_control(1),
            expected_control_id: control_id_of(&command_control(1)),
        }]
    );

    let mut installed_frontier = frontier(12);
    installed_frontier.received = Revision::new(safe(12));
    installed_frontier.material = Revision::new(safe(12));
    let installed = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(installed_frontier),
            &mut scheduler,
        )
        .expect("control install");
    let expected_proof = RecoveryAppliedProof {
        request_id: "recovery-1".to_owned(),
        frontier: Revision::new(safe(12)),
        material_digest: "material-digest".to_owned(),
        control_id: Some(control_id_of(&command_control(1))),
    };
    assert_eq!(
        installed,
        vec![
            RecoveryAction::Scheduler {
                command: SchedulerCommand::Cancel {
                    endpoint: control_timer.endpoint,
                    timer_id: control_timer.timer_id,
                },
            },
            RecoveryAction::SendAppliedProof {
                proof: expected_proof,
            },
            RecoveryAction::FenceChanged {
                view: open_fence_view(),
            },
        ]
    );
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Released));
    assert!(scheduler.live_timers().is_empty());
    assert!(transaction.diagnostics().timer_ids.is_empty());
}

#[test]
fn installed_outcome_missing_pacing_terminalizes_before_cancelling_control() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    assert!(scheduler.cancel(pacing_timer.timer_id).is_some());

    let before = transaction.diagnostics();
    let reason = "recovery pacing timer registration disappeared before control installation";
    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(frontier(12)),
            &mut scheduler,
        )
        .expect("missing pacing registration terminalizes");
    let terminal_view = transaction.fence_view().expect("terminal fence view");
    assert_eq!(
        actions,
        expected_terminal_actions(terminal_view.clone(), &[control_timer], reason)
    );
    assert_eq!(terminal_view.state, RecoveryFenceState::Terminal);
    assert_eq!(terminalize_count(&actions), 1);
    assert_eq!(before.phase, Some(RecoveryPhase::FrontierInstalled));
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn installed_outcome_missing_control_terminalizes_before_cancelling_pacing() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    assert!(scheduler.cancel(control_timer.timer_id).is_some());

    let before = transaction.diagnostics();
    let reason = "recovery control timer registration disappeared before control installation";
    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(frontier(12)),
            &mut scheduler,
        )
        .expect("missing control registration terminalizes");
    let terminal_view = transaction.fence_view().expect("terminal fence view");
    assert_eq!(
        actions,
        expected_terminal_actions(terminal_view.clone(), &[pacing_timer], reason)
    );
    assert_eq!(terminal_view.state, RecoveryFenceState::Terminal);
    assert_eq!(terminalize_count(&actions), 1);
    assert_eq!(before.phase, Some(RecoveryPhase::FrontierInstalled));
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn installed_outcome_after_mismatched_pacing_metadata_terminalizes_before_cancelling_control() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    let fired = scheduler
        .fired(pacing_timer.timer_id)
        .expect("pacing timer removal");
    let mut mismatched = fired.clone();
    mismatched.owner.reason = "wrong pacing registration".to_owned();
    let before = transaction.diagnostics();
    assert!(matches!(
        transaction.timer_fired(
            mismatched,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        ),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::FrontierInstalled)
        })
    ));
    assert_eq!(transaction.diagnostics(), before);

    let reason = "recovery pacing timer registration disappeared before control installation";
    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(frontier(12)),
            &mut scheduler,
        )
        .expect("mismatched pacing metadata terminalizes installed outcome");
    let terminal_view = transaction.fence_view().expect("terminal fence view");
    assert_eq!(
        actions,
        expected_terminal_actions(terminal_view.clone(), &[control_timer], reason)
    );
    assert_eq!(terminal_view.state, RecoveryFenceState::Terminal);
    assert_eq!(terminalize_count(&actions), 1);
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn installed_outcome_after_mismatched_control_metadata_terminalizes_before_cancelling_pacing() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    let fired = scheduler
        .fired(control_timer.timer_id)
        .expect("control timer removal");
    let mut mismatched = fired.clone();
    mismatched.owner.reason = "wrong control registration".to_owned();
    let before = transaction.diagnostics();
    assert!(matches!(
        transaction.timer_fired(
            mismatched,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        ),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::FrontierInstalled)
        })
    ));
    assert_eq!(transaction.diagnostics(), before);

    let reason = "recovery control timer registration disappeared before control installation";
    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(frontier(12)),
            &mut scheduler,
        )
        .expect("mismatched control metadata terminalizes installed outcome");
    let terminal_view = transaction.fence_view().expect("terminal fence view");
    assert_eq!(
        actions,
        expected_terminal_actions(terminal_view.clone(), &[pacing_timer], reason)
    );
    assert_eq!(terminal_view.state, RecoveryFenceState::Terminal);
    assert_eq!(terminalize_count(&actions), 1);
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn installed_outcome_mismatched_control_terminalizes_with_both_cancels_in_order() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let control_timer = scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("control timer");
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let pacing_timer = scheduled(&deferred);
    let wrong_control_id = "wrong-control".to_owned();
    let expected_control_id = control_id_of(&command_control(1));
    let reason =
        format!("control projection proved {wrong_control_id}, expected {expected_control_id}");

    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: wrong_control_id,
            },
            live_with_frontier(frontier(12)),
            &mut scheduler,
        )
        .expect("mismatched control proof terminalizes");
    let terminal_view = transaction.fence_view().expect("terminal fence view");
    assert_eq!(
        actions,
        expected_terminal_actions(
            terminal_view.clone(),
            &[control_timer, pacing_timer],
            &reason,
        )
    );
    assert_eq!(terminal_view.state, RecoveryFenceState::Terminal);
    assert_eq!(terminalize_count(&actions), 1);
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn installed_outcome_disposed_scheduler_terminalizes_without_successful_path_cancels() {
    let (mut transaction, mut scheduler) = prepare_control_pending();
    let deferred = transaction
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut scheduler,
        )
        .expect("pacing allocation");
    let _pacing_timer = scheduled(&deferred);
    scheduler.dispose();

    let reason = "recovery control timer registration disappeared before control installation";
    let actions = transaction
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(frontier(12)),
            &mut scheduler,
        )
        .expect("disposed scheduler terminalizes");
    let terminal_view = transaction.fence_view().expect("terminal fence view");
    assert_eq!(
        actions,
        expected_terminal_actions(terminal_view.clone(), &[], reason)
    );
    assert_eq!(terminal_view.state, RecoveryFenceState::Terminal);
    assert_eq!(terminalize_count(&actions), 1);
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
    assert!(transaction.diagnostics().timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn deferred_and_completion_paths_require_the_staged_then_installed_frontiers() {
    let (mut stale, mut stale_scheduler) = prepare_control_pending();
    let stale_control_timer = stale_scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("stale control timer");
    let stale_actions = stale
        .control_result(
            ControlProjectionOutcome::Deferred,
            live(10),
            &mut stale_scheduler,
        )
        .expect("stale deferred state terminalizes");
    assert_exact_terminal_actions(
        &stale,
        &stale_scheduler,
        &stale_actions,
        &[stale_control_timer],
        &format!(
            "recovery staged frontier changed under the fence (expected {:?}, live {:?})",
            staged_frontier(12),
            live(10).frontier
        ),
    );

    let (mut advanced, mut advanced_scheduler) = prepare_control_pending();
    let advanced_control_timer = advanced_scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("advanced control timer");
    let advanced_live = live_with_frontier(AuthorityFrontier {
        received: Revision::new(safe(13)),
        material: Revision::new(safe(12)),
        control: Revision::new(safe(11)),
    });
    let advanced_frontier = advanced_live.frontier;
    let advanced_actions = advanced
        .control_result(
            ControlProjectionOutcome::Deferred,
            advanced_live,
            &mut advanced_scheduler,
        )
        .expect("advanced deferred state terminalizes");
    assert_exact_terminal_actions(
        &advanced,
        &advanced_scheduler,
        &advanced_actions,
        &[advanced_control_timer],
        &format!(
            "recovery staged frontier changed under the fence (expected {:?}, live {:?})",
            staged_frontier(12),
            advanced_frontier
        ),
    );

    let (mut incomplete, mut incomplete_scheduler) = prepare_control_pending();
    let incomplete_control_timer = incomplete_scheduler
        .live_timers()
        .into_iter()
        .next()
        .expect("incomplete control timer");
    let incomplete_actions = incomplete
        .control_result(
            ControlProjectionOutcome::Installed {
                control_id: control_id_of(&command_control(1)),
            },
            live_with_frontier(staged_frontier(12)),
            &mut incomplete_scheduler,
        )
        .expect("completion requires installed frontier");
    assert_exact_terminal_actions(
        &incomplete,
        &incomplete_scheduler,
        &incomplete_actions,
        &[incomplete_control_timer],
        &format!(
            "recovery installed frontier changed under the fence (expected {:?}, live {:?})",
            frontier(12),
            staged_frontier(12)
        ),
    );
    assert!(
        incomplete_actions
            .iter()
            .all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. }))
    );
}

#[test]
fn rejected_staging_and_empty_inputs_fail_closed_without_completion_proof() {
    let (mut rejected, mut scheduler) = prepare_material_pending();
    let actions = rejected
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Rejected {
                reason: "replica refused".to_owned(),
            },
            live(10),
            &mut scheduler,
        )
        .expect("operational stage rejection");
    assert_exact_terminal_actions(
        &rejected,
        &scheduler,
        &actions,
        &[],
        "recovery frontier staging rejected: replica refused",
    );
    assert!(
        actions
            .iter()
            .all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. }))
    );

    let mut empty = transaction();
    let mut scheduler = KernelScheduler::new();
    assert!(matches!(
        empty.start(
            String::new(),
            frontier(0),
            "reason".to_owned(),
            &mut scheduler
        ),
        Err(RecoveryError::InvalidPhase { phase: None })
    ));
    assert!(matches!(
        empty.start(
            "request".to_owned(),
            frontier(0),
            String::new(),
            &mut scheduler
        ),
        Err(RecoveryError::InvalidPhase { phase: None })
    ));
    assert_eq!(empty.phase(), None);
    assert!(scheduler.live_timers().is_empty());
}

#[test]
fn scheduler_failure_terminalizes_atomically_and_cancels_survivors() {
    let mut request_transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    scheduler.dispose();

    let actions = request_transaction
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("scheduler failure is an operational terminal result");
    assert_exact_terminal_actions(
        &request_transaction,
        &scheduler,
        &actions,
        &[],
        "recovery request timer allocation failed: scheduler is disposed",
    );

    let mut stage = transaction();
    let mut stage_scheduler = KernelScheduler::new();
    stage
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut stage_scheduler,
        )
        .expect("stage setup start");
    stage
        .accept_bundle(bundle(10, 12), live(10), &mut stage_scheduler)
        .expect("stage setup accept");
    stage
        .material_result(
            RecoveryMaterialOutcome::Applied,
            live(10),
            &mut stage_scheduler,
        )
        .expect("stage setup material");
    stage_scheduler.dispose();
    let stage_actions = stage
        .recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Staged {
                revision: Revision::new(safe(12)),
            },
            live_with_frontier(staged_frontier(12)),
            &mut stage_scheduler,
        )
        .expect("control allocation failure is terminal");
    assert_exact_terminal_actions(
        &stage,
        &stage_scheduler,
        &stage_actions,
        &[],
        "recovery control timer allocation failed: scheduler is disposed",
    );

    let (mut deferred, mut deferred_scheduler) = prepare_control_pending();
    deferred_scheduler.dispose();
    let deferred_actions = deferred
        .control_result(
            ControlProjectionOutcome::Deferred,
            live_with_frontier(staged_frontier(12)),
            &mut deferred_scheduler,
        )
        .expect("disposed control registration is terminal");
    assert_exact_terminal_actions(
        &deferred,
        &deferred_scheduler,
        &deferred_actions,
        &[],
        "recovery control timer registration disappeared before deferred retry",
    );
}

#[test]
fn abort_and_dispose_cancel_via_scheduler_and_are_idempotent() {
    let mut aborted = transaction();
    let mut scheduler = KernelScheduler::new();
    let start_actions = aborted
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let request_timer = scheduled(&start_actions);
    let actions = aborted.abort("operator cancelled".to_owned(), &mut scheduler);
    assert_exact_terminal_actions(
        &aborted,
        &scheduler,
        &actions,
        &[request_timer],
        "operator cancelled",
    );
    assert!(
        aborted
            .abort("second".to_owned(), &mut scheduler)
            .is_empty()
    );
    assert!(matches!(
        aborted.start(
            "again".to_owned(),
            frontier(0),
            "again".to_owned(),
            &mut scheduler
        ),
        Err(RecoveryError::Terminalized { .. })
    ));

    let mut disposed = transaction();
    let mut scheduler = KernelScheduler::new();
    let start_actions = disposed
        .start(
            "recovery-1".to_owned(),
            frontier(10),
            "rejoin".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    let request_timer = scheduled(&start_actions);
    let actions = disposed.dispose("dispose reason", &mut scheduler);
    assert_exact_terminal_actions(
        &disposed,
        &scheduler,
        &actions,
        &[request_timer],
        "dispose reason",
    );
    assert!(disposed.dispose("second", &mut scheduler).is_empty());
    assert!(disposed.diagnostics().disposed);
    assert!(disposed.fence_view().is_none());
    assert!(matches!(
        disposed.timer_fired(
            ScheduledTimer {
                endpoint: SeatId::new(safe(1)),
                timer_id: TimerId::ZERO,
                owner: TimerOwner {
                    owner_id: "recovery-owner".to_owned(),
                    address: "recovery/session-1/run-1/recovery-1".to_owned(),
                    reason: "authority-v2 recovery request deadline".to_owned(),
                },
                delay_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
                time_class: TimeClass::Recovery,
            },
            live(10),
            &mut scheduler
        ),
        Err(RecoveryError::Disposed)
    ));
}

#[test]
fn zero_frontier_uses_terminal_only_noop_semantics_and_releases_the_fence() {
    let mut transaction = transaction();
    let mut scheduler = KernelScheduler::new();
    transaction
        .start(
            "recovery-1".to_owned(),
            frontier(0),
            "empty".to_owned(),
            &mut scheduler,
        )
        .expect("start");
    transaction
        .accept_bundle(bundle(0, 0), live(0), &mut scheduler)
        .expect("accept");
    let actions = transaction
        .material_result(RecoveryMaterialOutcome::Applied, live(0), &mut scheduler)
        .expect("material");
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Released));
    assert_eq!(
        actions,
        vec![
            RecoveryAction::SendAppliedProof {
                proof: RecoveryAppliedProof {
                    request_id: "recovery-1".to_owned(),
                    frontier: Revision::ZERO,
                    material_digest: "material-digest".to_owned(),
                    control_id: None,
                },
            },
            RecoveryAction::FenceChanged {
                view: open_fence_view(),
            },
        ]
    );
    assert!(scheduler.live_timers().is_empty());
    assert!(transaction.diagnostics().timer_ids.is_empty());
}
