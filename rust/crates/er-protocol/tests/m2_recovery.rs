use er_protocol::{
    ControlProjectionOutcome, DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS, DEFAULT_RECOVERY_PACING_MS,
    DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS, RecoveryAction, RecoveryBundleValidation, RecoveryError,
    RecoveryFence, RecoveryMaterialOutcome, RecoveryTransaction, RecoveryTransactionConfig,
    RecoveryValidationContext, SchedulerCommand, control_id_of, validate_recovery_bundle,
};
use er_types::{
    AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, FrameContext, Material, MembershipRevision,
    NextControl, OperationId, RecoveryAppliedProof, RecoveryBundle, RecoveryFenceState,
    RecoveryPhase, Revision, RunId, SafeU53, SeatId, SessionId,
};

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("test operation id must be valid")
}

fn session(value: &str) -> SessionId {
    SessionId::new(value).expect("test session id must be valid")
}

fn run(value: &str) -> RunId {
    RunId::new(value).expect("test run id must be valid")
}

fn authority_context() -> FrameContext {
    FrameContext {
        session_id: session("session-1"),
        run_id: run("run-1"),
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

fn validation_context(captured: u64) -> RecoveryValidationContext {
    RecoveryValidationContext {
        expected_request_id: "recovery-1".to_owned(),
        live_context: replica_context(),
        captured_frontier: Revision::new(safe(captured)),
    }
}

fn authority_frontier(revision: u64) -> AuthorityFrontier {
    AuthorityFrontier {
        received: Revision::new(safe(revision)),
        material: Revision::new(safe(revision)),
        control: Revision::new(safe(revision)),
    }
}

fn transaction() -> RecoveryTransaction {
    RecoveryTransaction::new(RecoveryTransactionConfig {
        local_context: replica_context(),
        request_timeout_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
        control_timeout_ms: safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS),
        pacing_ms: safe(DEFAULT_RECOVERY_PACING_MS),
        timer_owner_id: "recovery-owner".to_owned(),
    })
    .expect("test recovery transaction config must be valid")
}

fn assert_mismatch(result: RecoveryBundleValidation) {
    assert!(matches!(
        result,
        RecoveryBundleValidation::Mismatch { issues } if !issues.is_empty()
    ));
}

fn assert_valid(result: RecoveryBundleValidation) {
    assert!(matches!(result, RecoveryBundleValidation::Valid { .. }));
}

fn scheduled_delay(actions: &[RecoveryAction], timer_id: er_types::TimerId) -> Option<SafeU53> {
    actions.iter().find_map(|action| match action {
        RecoveryAction::Scheduler {
            command: SchedulerCommand::Schedule { timer: scheduled },
        } if scheduled.timer_id == timer_id => Some(scheduled.delay_ms),
        _ => None,
    })
}

#[test]
fn fence_is_one_shot_and_only_the_stated_control_window_unfreezes_surface_start() {
    let mut fence = RecoveryFence::new();
    assert_eq!(fence.state(), RecoveryFenceState::Open);
    assert!(!fence.is_command_admission_frozen());
    assert!(fence.acquire());
    assert!(!fence.acquire());
    assert_eq!(fence.state(), RecoveryFenceState::Held);
    assert!(fence.is_command_admission_frozen());
    assert!(fence.is_progression_frozen());
    assert!(fence.is_materialization_frozen());
    assert!(fence.is_control_surface_start_frozen());
    assert!(fence.is_authority_wait_creation_frozen());

    assert!(fence.allow_control_projection());
    assert!(!fence.allow_control_projection());
    assert!(fence.is_command_admission_frozen());
    assert!(fence.is_progression_frozen());
    assert!(fence.is_materialization_frozen());
    assert!(!fence.is_control_surface_start_frozen());
    assert!(!fence.is_authority_wait_creation_frozen());

    fence.release();
    assert_eq!(fence.state(), RecoveryFenceState::Open);
    assert!(!fence.is_progression_frozen());
    assert!(!fence.is_control_surface_start_frozen());

    fence.terminalize("first terminal reason".to_owned());
    fence.release();
    fence.terminalize("second terminal reason".to_owned());
    assert_eq!(fence.state(), RecoveryFenceState::Terminal);
    assert_eq!(fence.terminal_reason(), Some("first terminal reason"));
    assert!(fence.is_command_admission_frozen());
    assert!(fence.is_control_surface_start_frozen());
    assert!(fence.is_progression_frozen());
    assert!(fence.is_materialization_frozen());
    assert!(fence.is_authority_wait_creation_frozen());
}

#[test]
fn recovery_validation_accepts_zero_equal_and_dense_forward_shapes() {
    assert_valid(validate_recovery_bundle(
        &validation_context(0),
        &bundle(0, 0),
    ));
    assert_valid(validate_recovery_bundle(
        &validation_context(12),
        &bundle(12, 12),
    ));
    assert_valid(validate_recovery_bundle(
        &validation_context(10),
        &bundle(10, 12),
    ));

    assert!(matches!(
        validate_recovery_bundle(&validation_context(10), &bundle(10, 8)),
        RecoveryBundleValidation::Stale {
            captured_frontier,
            bundle_frontier,
        } if captured_frontier == Revision::new(safe(10))
            && bundle_frontier == Revision::new(safe(8))
    ));
}

#[test]
fn recovery_validation_rejects_every_request_context_and_membership_dimension() {
    let mut changed = bundle(10, 12);
    changed.request_id = "older-request".to_owned();
    assert_mismatch(validate_recovery_bundle(&validation_context(10), &changed));

    let mutators: &[fn(&mut FrameContext)] = &[
        |context: &mut FrameContext| context.session_id = session("other-session"),
        |context: &mut FrameContext| context.run_id = run("other-run"),
        |context: &mut FrameContext| context.session_epoch = safe(99),
        |context: &mut FrameContext| context.seat_map_id = "other-seat-map".to_owned(),
        |context: &mut FrameContext| {
            context.membership_revision = MembershipRevision::new(safe(99))
        },
        |context: &mut FrameContext| context.authority_seat_id = SeatId::new(safe(9)),
        |context: &mut FrameContext| context.sender_seat_id = SeatId::new(safe(1)),
    ];
    for mutate in mutators {
        let mut candidate = bundle(10, 12);
        (*mutate)(&mut candidate.context);
        assert_mismatch(validate_recovery_bundle(
            &validation_context(10),
            &candidate,
        ));
    }

    let mut membership_field = bundle(10, 12);
    membership_field.membership_revision = MembershipRevision::new(safe(7));
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &membership_field,
    ));
}

#[test]
fn recovery_validation_rejects_material_frontier_nullability_and_tail_dimensions() {
    let mut no_digest = bundle(10, 12);
    no_digest.material.digest.clear();
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &no_digest,
    ));

    let mut zero_with_operation = bundle(0, 0);
    zero_with_operation.frontier_operation_id = Some(operation("unexpected"));
    assert_mismatch(validate_recovery_bundle(
        &validation_context(0),
        &zero_with_operation,
    ));

    let mut zero_with_control = bundle(0, 0);
    zero_with_control.next_control = Some(command_control(1));
    assert_mismatch(validate_recovery_bundle(
        &validation_context(0),
        &zero_with_control,
    ));

    let mut positive_without_operation = bundle(10, 12);
    positive_without_operation.frontier_operation_id = None;
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &positive_without_operation,
    ));

    let mut positive_without_control = bundle(10, 12);
    positive_without_control.next_control = None;
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &positive_without_control,
    ));

    let mut empty_tail = bundle(10, 12);
    empty_tail.required_tail.clear();
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &empty_tail,
    ));

    let mut non_contiguous = bundle(10, 12);
    non_contiguous.required_tail[1].revision = Revision::new(safe(14));
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &non_contiguous,
    ));

    let mut duplicated_operation = bundle(10, 12);
    duplicated_operation.required_tail[1].operation_id =
        duplicated_operation.required_tail[0].operation_id.clone();
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &duplicated_operation,
    ));

    let mut final_operation_mismatch = bundle(10, 12);
    final_operation_mismatch.frontier_operation_id = Some(operation("different-operation"));
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &final_operation_mismatch,
    ));

    let mut final_control_mismatch = bundle(10, 12);
    final_control_mismatch.next_control = Some(command_control(2));
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &final_control_mismatch,
    ));

    let mut tail_context_mismatch = bundle(10, 12);
    tail_context_mismatch.required_tail[1].context = replica_context();
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &tail_context_mismatch,
    ));
}

#[test]
fn recovery_validation_rejects_invalid_controls_and_entry_invariants() {
    let mut invalid_command = bundle(10, 12);
    invalid_command.required_tail[1].next_control = command_control(0);
    invalid_command.next_control = invalid_command.required_tail[1].next_control.clone().into();
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &invalid_command,
    ));

    let mut invalid_subsumption = bundle(10, 12);
    invalid_subsumption.required_tail[1].subsumes = vec![Revision::ZERO];
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &invalid_subsumption,
    ));

    let mut incompatible_terminal = bundle(10, 12);
    incompatible_terminal.required_tail[1].kind = AuthorityEntryKind::TerminalCommit;
    assert_mismatch(validate_recovery_bundle(
        &validation_context(10),
        &incompatible_terminal,
    ));
}

#[test]
fn transaction_start_fences_before_request_and_schedules_recovery_timeout() {
    let mut transaction = transaction();
    let actions = transaction
        .start(
            "recovery-1".to_owned(),
            authority_frontier(10),
            "rejoin".to_owned(),
        )
        .expect("transaction start must succeed");
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Requested));
    let view = transaction
        .fence_view()
        .expect("started transaction must expose its fence");
    assert_eq!(view.state, RecoveryFenceState::Held);
    assert!(view.command_admission_frozen);
    assert!(view.progression_frozen);
    assert!(view.materialization_frozen);
    assert!(view.control_surface_start_frozen);
    assert!(view.authority_wait_creation_frozen);
    assert_eq!(
        scheduled_delay(&actions, er_types::TimerId::ZERO),
        Some(safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS))
    );
    assert!(
        matches!(actions.last(), Some(RecoveryAction::SendRequest { request }) if request.request_id == "recovery-1" && request.captured_frontier == Revision::new(safe(10)))
    );
}

#[test]
fn transaction_happy_path_reaches_every_mechanical_phase_and_releases_after_proof() {
    let mut transaction = transaction();
    let _ = transaction.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let accepted =
        transaction.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
    assert!(accepted.is_ok());
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Validated));
    let applied = transaction.material_result(
        RecoveryMaterialOutcome::Applied,
        authority_frontier(10),
        &replica_context(),
    );
    assert!(applied.is_ok());
    assert_eq!(transaction.phase(), Some(RecoveryPhase::MaterialApplied));
    assert!(matches!(
        applied.as_ref().ok().and_then(|actions| actions.first()),
        Some(RecoveryAction::StageRecoveredFrontier { entry }) if entry.revision == Revision::new(safe(12))
    ));

    let staged = transaction.recovered_frontier_staged(Revision::new(safe(12)));
    assert!(staged.is_ok());
    assert_eq!(transaction.phase(), Some(RecoveryPhase::FrontierInstalled));
    let view = transaction
        .fence_view()
        .expect("frontier-installed transaction must expose its fence");
    assert!(view.command_admission_frozen);
    assert!(!view.control_surface_start_frozen);
    assert!(!view.authority_wait_creation_frozen);
    assert_eq!(
        scheduled_delay(
            staged.as_ref().ok().map_or(&[], Vec::as_slice),
            er_types::TimerId::new(safe(1))
        ),
        Some(safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS))
    );

    let installed = transaction.control_result(ControlProjectionOutcome::Installed {
        control_id: control_id_of(&command_control(1)),
    });
    assert!(installed.is_ok());
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Released));
    let diagnostics = transaction.diagnostics();
    assert!(diagnostics.timer_ids.is_empty());
    assert_eq!(diagnostics.fence_state, Some(RecoveryFenceState::Open));
    assert!(matches!(
        installed.as_ref().ok().and_then(|actions| actions.iter().find_map(|action| match action {
            RecoveryAction::SendAppliedProof { proof } => Some(proof),
            _ => None,
        })),
        Some(RecoveryAppliedProof { control_id: Some(_), frontier, .. }) if *frontier == Revision::new(safe(12))
    ));
}

#[test]
fn transaction_zero_frontier_has_null_control_proof_and_no_synthetic_entry() {
    let mut transaction = transaction();
    let _ = transaction.start(
        "recovery-1".to_owned(),
        authority_frontier(0),
        "empty".to_owned(),
    );
    assert!(
        transaction
            .accept_bundle(bundle(0, 0), authority_frontier(0), &replica_context())
            .is_ok()
    );
    let actions = transaction
        .material_result(
            RecoveryMaterialOutcome::Applied,
            authority_frontier(0),
            &replica_context(),
        )
        .expect("zero-frontier material application must succeed");
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Released));
    assert!(actions.iter().all(|action| !matches!(
        action,
        RecoveryAction::StageRecoveredFrontier { .. } | RecoveryAction::ProjectControl { .. }
    )));
    let proof = actions
        .iter()
        .find_map(|action| match action {
            RecoveryAction::SendAppliedProof { proof } => Some(proof),
            _ => None,
        })
        .expect("zero frontier must still emit a completion proof");
    assert!(proof.control_id.is_none());
    let encoded = serde_json::to_value(proof).ok();
    assert!(encoded.is_some());
    assert!(
        encoded
            .as_ref()
            .and_then(|value| value.as_object())
            .is_some_and(|object| !object.contains_key("controlId"))
    );
}

#[test]
fn deferred_control_uses_exact_pacing_and_retries_without_duplicate_timers() {
    let mut transaction = transaction();
    let _ = transaction.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let _ = transaction.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
    let _ = transaction.material_result(
        RecoveryMaterialOutcome::Applied,
        authority_frontier(10),
        &replica_context(),
    );
    let _ = transaction.recovered_frontier_staged(Revision::new(safe(12)));

    let deferred = transaction
        .control_result(ControlProjectionOutcome::Deferred)
        .ok();
    assert!(deferred.is_some());
    assert_eq!(
        scheduled_delay(
            deferred.as_ref().map_or(&[], Vec::as_slice),
            er_types::TimerId::new(safe(2))
        ),
        Some(safe(DEFAULT_RECOVERY_PACING_MS))
    );
    let duplicate = transaction
        .control_result(ControlProjectionOutcome::Deferred)
        .ok();
    assert_eq!(duplicate, Some(Vec::new()));
    let retry = transaction
        .timer_fired(er_types::TimerId::new(safe(2)))
        .ok();
    assert!(matches!(
        retry.as_ref().and_then(|actions| actions.first()),
        Some(RecoveryAction::ProjectControl { .. })
    ));
    assert!(
        transaction
            .control_result(ControlProjectionOutcome::AlreadyInstalled {
                control_id: control_id_of(&command_control(1)),
            })
            .is_ok()
    );
    assert_eq!(transaction.phase(), Some(RecoveryPhase::Released));
}

#[test]
fn request_and_control_timeout_boundaries_terminalize_and_cancel_remaining_timers() {
    let mut request_timeout = transaction();
    let _ = request_timeout.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let request_actions = request_timeout.timer_fired(er_types::TimerId::ZERO).ok();
    assert!(request_actions.is_some());
    assert_eq!(request_timeout.phase(), Some(RecoveryPhase::Terminalized));
    assert_eq!(
        request_timeout.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Terminal)
    );
    assert!(
        request_timeout
            .fence_view()
            .and_then(|view| view.terminal_reason)
            .is_some_and(|reason| reason.contains("request timeout"))
    );
    assert!(request_timeout.diagnostics().timer_ids.is_empty());

    let mut control_timeout = transaction();
    let _ = control_timeout.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let _ =
        control_timeout.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
    let _ = control_timeout.material_result(
        RecoveryMaterialOutcome::Applied,
        authority_frontier(10),
        &replica_context(),
    );
    let _ = control_timeout.recovered_frontier_staged(Revision::new(safe(12)));
    let timeout_actions = control_timeout
        .timer_fired(er_types::TimerId::new(safe(1)))
        .ok();
    assert!(timeout_actions.is_some());
    assert_eq!(control_timeout.phase(), Some(RecoveryPhase::Terminalized));
    assert!(
        control_timeout
            .fence_view()
            .and_then(|view| view.terminal_reason)
            .is_some_and(|reason| reason.contains("control-install timeout"))
    );
    assert!(control_timeout.diagnostics().timer_ids.is_empty());
}

#[test]
fn cancellation_and_disposal_are_idempotent_and_fail_closed() {
    let mut aborted = transaction();
    let _ = aborted.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let actions = aborted.abort("operator cancelled".to_owned());
    assert!(actions.iter().any(|action| matches!(action, RecoveryAction::Terminalize { reason } if reason == "operator cancelled")));
    assert!(actions.iter().any(|action| matches!(action, RecoveryAction::Scheduler { command: SchedulerCommand::Cancel { timer_id, .. } } if *timer_id == er_types::TimerId::ZERO)));
    assert!(aborted.abort("second cancellation".to_owned()).is_empty());
    assert!(matches!(
        aborted.start(
            "again".to_owned(),
            authority_frontier(0),
            "again".to_owned()
        ),
        Err(RecoveryError::Terminalized { .. })
    ));

    let mut disposed = transaction();
    let _ = disposed.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let first_dispose = disposed.dispose("dispose reason");
    assert!(first_dispose.iter().any(|action| matches!(action, RecoveryAction::Terminalize { reason } if reason == "dispose reason")));
    assert!(disposed.dispose("second dispose").is_empty());
    assert!(disposed.diagnostics().disposed);
    assert!(disposed.fence_view().is_none());
    assert!(matches!(
        disposed.timer_fired(er_types::TimerId::ZERO),
        Err(RecoveryError::Disposed)
    ));
}

#[test]
fn material_and_control_failures_never_emit_completion_proof() {
    for outcome in [
        RecoveryMaterialOutcome::Deferred,
        RecoveryMaterialOutcome::Rejected,
    ] {
        let mut transaction = transaction();
        let _ = transaction.start(
            "recovery-1".to_owned(),
            authority_frontier(10),
            "rejoin".to_owned(),
        );
        let _ =
            transaction.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
        let actions = transaction
            .material_result(outcome, authority_frontier(10), &replica_context())
            .ok();
        assert!(actions.is_some());
        assert_eq!(transaction.phase(), Some(RecoveryPhase::Terminalized));
        assert!(actions.as_ref().is_some_and(|actions| {
            actions
                .iter()
                .all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. }))
        }));
    }

    let mut wrong_control = transaction();
    let _ = wrong_control.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let _ = wrong_control.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
    let _ = wrong_control.material_result(
        RecoveryMaterialOutcome::Applied,
        authority_frontier(10),
        &replica_context(),
    );
    let _ = wrong_control.recovered_frontier_staged(Revision::new(safe(12)));
    let actions = wrong_control
        .control_result(ControlProjectionOutcome::Installed {
            control_id: "wrong-control".to_owned(),
        })
        .ok();
    assert!(actions.is_some());
    assert_eq!(wrong_control.phase(), Some(RecoveryPhase::Terminalized));
    assert!(actions.as_ref().is_some_and(|actions| {
        actions
            .iter()
            .all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. }))
    }));
}

#[test]
fn post_apply_frontier_or_context_change_terminalizes_before_frontier_staging() {
    let mut stale_transaction = transaction();
    let _ = stale_transaction.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let _ =
        stale_transaction.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
    let result = stale_transaction.material_result(
        RecoveryMaterialOutcome::Applied,
        authority_frontier(11),
        &replica_context(),
    );
    assert!(matches!(result, Err(RecoveryError::StaleBundle)));
    assert_eq!(stale_transaction.phase(), Some(RecoveryPhase::Terminalized));

    let mut context_changed = transaction();
    let _ = context_changed.start(
        "recovery-1".to_owned(),
        authority_frontier(10),
        "rejoin".to_owned(),
    );
    let _ =
        context_changed.accept_bundle(bundle(10, 12), authority_frontier(10), &replica_context());
    let changed_context = FrameContext {
        membership_revision: MembershipRevision::new(safe(3)),
        ..replica_context()
    };
    let result = context_changed.material_result(
        RecoveryMaterialOutcome::Applied,
        authority_frontier(10),
        &changed_context,
    );
    assert!(matches!(result, Err(RecoveryError::BundleMismatch { .. })));
    assert_eq!(context_changed.phase(), Some(RecoveryPhase::Terminalized));
}
