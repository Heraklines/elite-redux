use std::error::Error;

use er_protocol::{
    AckStage, AuthorityEntryDraft, AuthorityEntryKind, AuthorityLog, AuthorityLogAction,
    AuthorityLogConfig, AuthorityLogError, AuthorityLogSnapshotBridge, AuthorityReceiptVerdict,
    BackoffPolicy, FrameContext, KernelScheduler, Material, NextControl, PeerBinding,
    ReceiptRejectReason, SchedulerCommand, SnapshotError, TimeClass, control_id_of,
};
use er_types::battle_ids::CanonicalHexBytes;
use er_types::{
    CommandControlTarget, CommandFrontierControl, ConnectionGeneration, OperationId, Revision,
    RunId, SafeU53, SeatId, SessionId, TerminalControl, TimerId, TimerOwner,
};
use serde_json::json;

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> Result<SeatId, Box<dyn Error>> {
    Ok(SeatId::new(safe(value)?))
}

fn generation(value: u64) -> Result<ConnectionGeneration, Box<dyn Error>> {
    Ok(ConnectionGeneration::new(safe(value)?))
}

fn context(connection_generation: u64) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("authority-test")?,
        run_id: RunId::new("run-a")?,
        session_epoch: safe(1)?,
        seat_map_id: "seat-map-a".to_owned(),
        membership_revision: er_types::MembershipRevision::new(safe(1)?),
        sender_seat_id: seat(0)?,
        authority_seat_id: seat(0)?,
        connection_generation: generation(connection_generation)?,
    })
}

fn command_control() -> Result<NextControl, Box<dyn Error>> {
    Ok(NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1)?,
        wave: safe(1)?,
        turn: safe(1)?,
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(0)?,
            pokemon_id: safe(42)?,
            field_index: safe(0)?,
        }],
    }))
}

fn config(capacity: u64, peers: &[(u64, u64)]) -> Result<AuthorityLogConfig, Box<dyn Error>> {
    config_with_owner_and_attempts(capacity, peers, "authority-test", None)
}

fn config_with_owner_and_attempts(
    capacity: u64,
    peers: &[(u64, u64)],
    owner_id: &str,
    max_delivery_attempts: Option<u64>,
) -> Result<AuthorityLogConfig, Box<dyn Error>> {
    Ok(AuthorityLogConfig {
        local_context: context(1)?,
        peer_bindings: peers
            .iter()
            .map(|(seat_id, connection_generation)| {
                Ok(PeerBinding {
                    seat_id: seat(*seat_id)?,
                    connection_generation: generation(*connection_generation)?,
                })
            })
            .collect::<Result<Vec<_>, Box<dyn Error>>>()?,
        owner_id: owner_id.to_owned(),
        retain_capacity: safe(capacity)?,
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250)?,
            maximum_ms: safe(5_000)?,
            factor_numerator: safe(2)?,
            factor_denominator: safe(1)?,
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: max_delivery_attempts.map(safe).transpose()?,
    })
}

fn draft(operation: &str) -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    Ok(AuthorityEntryDraft {
        context: context(1)?,
        operation_id: OperationId::new(operation.to_owned())?,
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: format!("digest-{operation}"),
            payload: json!({
                "operation": operation,
                "epoch": 1,
                "wave": 1,
                "turn": 1,
            }),
        },
        next_control: command_control()?,
        subsumes: Vec::new(),
    })
}

fn control_id() -> &'static str {
    // Independent oracle literal for the fixture command frontier.
    "COMMAND_FRONTIER/e1/w1/t1/f0:s0:p42"
}

fn receipt(
    entry: &er_types::AuthorityEntry,
    peer: u64,
    connection_generation: u64,
    stage: AckStage,
) -> Result<er_types::AuthorityReceipt, Box<dyn Error>> {
    let mut receipt_context = entry.context.clone();
    receipt_context.sender_seat_id = seat(peer)?;
    receipt_context.connection_generation = generation(connection_generation)?;
    Ok(er_types::AuthorityReceipt {
        context: receipt_context,
        revision: entry.revision,
        operation_id: entry.operation_id.clone(),
        stage,
        control_id: (stage == AckStage::ControlInstalled)
            .then(|| control_id_of(&entry.next_control)),
    })
}

fn scheduled_timer_id(actions: &[AuthorityLogAction]) -> Option<TimerId> {
    actions.iter().find_map(|action| match action {
        AuthorityLogAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        } => Some(timer.timer_id),
        AuthorityLogAction::Deliver { .. }
        | AuthorityLogAction::TailProof { .. }
        | AuthorityLogAction::Scheduler {
            command:
                SchedulerCommand::Cancel { .. }
                | SchedulerCommand::PauseClass { .. }
                | SchedulerCommand::ResumeClass { .. },
        } => None,
    })
}

fn scheduler_commands(actions: &[AuthorityLogAction]) -> Vec<&SchedulerCommand> {
    actions
        .iter()
        .filter_map(|action| match action {
            AuthorityLogAction::Scheduler { command } => Some(command),
            AuthorityLogAction::Deliver { .. } | AuthorityLogAction::TailProof { .. } => None,
        })
        .collect()
}

fn deliver_count(actions: &[AuthorityLogAction]) -> usize {
    actions
        .iter()
        .filter(|action| matches!(action, AuthorityLogAction::Deliver { .. }))
        .count()
}

#[test]
fn timer_owner_uses_the_shared_nonempty_opaque_boundary() -> TestResult {
    let long_control_owner = format!("{}\u{0001}\u{007f}", "🙂".repeat(200));
    assert!(TimerOwner::new(long_control_owner.as_str(), "address\u{0000}", "reason").is_ok());
    assert!(TimerOwner::new("", "address", "reason").is_err());
    assert!(TimerOwner::new("owner", "", "reason").is_err());
    assert!(TimerOwner::new("owner", "address", "").is_err());

    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config_with_owner_and_attempts(
        8,
        &[(1, 1)],
        &long_control_owner,
        None,
    )?)?;
    let committed = log.commit(draft("opaque-owner")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let timer = scheduler.timer(timer_id).ok_or("timer not live")?;
    assert_eq!(
        timer.owner.owner_id,
        format!("{long_control_owner}:delivery:1")
    );
    assert_eq!(timer.owner.address, "authority-log/delivery/1");
    assert_eq!(
        timer.owner.reason,
        "redeliver revision 1 until mechanical quorum"
    );

    let empty = AuthorityLog::new(config_with_owner_and_attempts(8, &[(1, 1)], "", None)?);
    assert!(matches!(
        empty,
        Err(AuthorityLogError::InvalidConfig { .. })
    ));
    Ok(())
}

#[test]
fn malformed_entry_boundaries_fail_before_revision_token_or_timer_consumption() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;

    let too_long_operation = "🙂".repeat(129);
    assert!(matches!(
        log.commit(draft(&too_long_operation)?, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));
    assert!(matches!(
        log.commit(draft("operation\u{0001}")?, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));

    let mut too_long_digest = draft("digest-too-long")?;
    too_long_digest.material.digest = "🙂".repeat(129);
    assert!(matches!(
        log.commit(too_long_digest, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));

    let mut malformed_successor = draft("malformed-successor")?;
    malformed_successor.next_control = NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1)?,
        wave: safe(1)?,
        turn: safe(1)?,
        commands: Vec::new(),
    });
    assert!(matches!(
        log.commit(malformed_successor, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));

    let mut mismatched_context = draft("mismatched-context")?;
    mismatched_context.context.run_id = RunId::new("other-run")?;
    assert!(matches!(
        log.commit(mismatched_context, &mut scheduler),
        Err(AuthorityLogError::ContextMismatch)
    ));

    assert_eq!(log.head_revision(), Revision::ZERO);
    assert_eq!(log.diagnostics().retained_revisions.len(), 0);
    assert!(scheduler.live_timers().is_empty());

    let mut boundary_scheduler = KernelScheduler::new();
    let mut boundary_log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let boundary_operation = "🙂".repeat(128);
    let mut boundary = draft(&boundary_operation)?;
    boundary.material.digest = "🙂".repeat(128);
    let boundary_commit = boundary_log.commit(boundary, &mut boundary_scheduler)?;
    assert_eq!(boundary_commit.entry.revision, Revision::new(safe(1)?));
    assert_eq!(
        boundary_commit.entry.operation_id.as_str(),
        boundary_operation
    );
    assert_eq!(
        boundary_commit.entry.material.digest.encode_utf16().count(),
        256
    );
    assert_eq!(
        scheduled_timer_id(&boundary_commit.actions),
        Some(TimerId::new(SafeU53::ZERO))
    );

    let mut control_bearing_digest = draft("control-bearing-digest")?;
    control_bearing_digest.material.digest = "digest\u{0000}\u{001f}\u{007f}\u{0080}".to_owned();
    let committed = log.commit(control_bearing_digest, &mut scheduler)?;
    assert_eq!(committed.entry.revision, Revision::new(safe(1)?));
    assert_eq!(
        committed.entry.material.digest,
        "digest\u{0000}\u{001f}\u{007f}\u{0080}"
    );
    assert_eq!(
        scheduled_timer_id(&committed.actions),
        Some(TimerId::new(SafeU53::ZERO))
    );
    Ok(())
}

#[test]
fn canonical_control_id_is_used_by_a_real_commit_and_receipt_path() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("canonical-control")?, &mut scheduler)?;

    // The literal is an independent pinned-oracle expectation; this assertion proves the production
    // successor/control-ID implementation agrees with it on the actual committed control.
    assert_eq!(control_id_of(&committed.entry.next_control), control_id());
    let control_receipt = receipt(&committed.entry, 1, 1, AckStage::ControlInstalled)?;
    assert_eq!(control_receipt.control_id.as_deref(), Some(control_id()));
    let outcome = log.accept_receipt_detailed(control_receipt, &mut scheduler);
    assert!(matches!(
        outcome.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: true,
            waiting_for_seat_ids
        } if waiting_for_seat_ids.is_empty()
    ));
    assert!(log.retained().is_empty());
    Ok(())
}

#[test]
fn commit_uses_scheduler_id_zero_and_schedules_before_delivery() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;

    let outcome = log.commit(draft("first")?, &mut scheduler)?;
    assert_eq!(
        scheduled_timer_id(&outcome.actions),
        Some(TimerId::new(SafeU53::ZERO))
    );
    assert!(matches!(
        outcome.actions.first(),
        Some(AuthorityLogAction::Scheduler {
            command: SchedulerCommand::Schedule { .. }
        })
    ));
    assert!(matches!(
        outcome.actions.get(1),
        Some(AuthorityLogAction::Deliver { to, .. }) if *to == seat(1)?
    ));
    assert_eq!(scheduler.pending_timer_count(), safe(1)?);
    assert_eq!(log.head_revision(), Revision::new(safe(1)?));
    Ok(())
}

#[test]
fn disposed_scheduler_failure_is_atomic_and_does_not_burn_revision_or_timer_id() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    scheduler.dispose();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let before = log.diagnostics();

    assert!(matches!(
        log.commit(draft("scheduler-failure")?, &mut scheduler),
        Err(AuthorityLogError::Scheduler(
            er_protocol::SchedulerError::Disposed
        ))
    ));
    assert_eq!(log.diagnostics(), before);
    assert_eq!(scheduler.live_timers(), Vec::new());

    let mut fresh_scheduler = KernelScheduler::new();
    let retry = log.commit(draft("scheduler-retry")?, &mut fresh_scheduler)?;
    assert_eq!(retry.entry.revision, Revision::new(safe(1)?));
    assert_eq!(
        scheduled_timer_id(&retry.actions),
        Some(TimerId::new(SafeU53::ZERO))
    );
    Ok(())
}

#[test]
fn fired_timer_is_exactly_once_and_allocates_nonreused_ids() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("retry")?, &mut scheduler)?;
    let first_id = scheduled_timer_id(&committed.actions).ok_or("missing first timer")?;
    let first_fired = scheduler.fired(first_id)?;

    let retry_actions = log.timer_fired(first_fired.clone(), &mut scheduler)?;
    let second_id = scheduled_timer_id(&retry_actions).ok_or("missing second timer")?;
    assert_eq!(first_id, TimerId::new(SafeU53::ZERO));
    assert_eq!(second_id, TimerId::new(safe(1)?));
    assert_eq!(
        scheduler.timer(second_id).map(|timer| timer.delay_ms),
        Some(safe(500)?)
    );
    assert!(matches!(
        log.timer_fired(first_fired, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));

    let second_fired = scheduler.fired(second_id)?;
    let third_actions = log.timer_fired(second_fired, &mut scheduler)?;
    assert_eq!(
        scheduled_timer_id(&third_actions),
        Some(TimerId::new(safe(2)?))
    );
    Ok(())
}

#[test]
fn retry_scheduler_disposal_terminalizes_without_publishing_attempt_or_delay() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("retry-disposal")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let fired = scheduler.fired(timer_id)?;
    scheduler.dispose();

    let result = log.timer_fired(fired.clone(), &mut scheduler);
    assert!(matches!(
        result,
        Err(AuthorityLogError::Scheduler(
            er_protocol::SchedulerError::Disposed
        ))
    ));
    assert_eq!(log.head_revision(), committed.entry.revision);
    assert_eq!(
        log.retained_entry(committed.entry.revision),
        Some(&committed.entry)
    );
    assert!(log.diagnostics().delivery_timer_ids.is_empty());
    assert!(scheduler.live_timers().is_empty());

    // The consumed timer cannot be replayed, and the failed lease is stopped rather than remaining an
    // unresolved non-stopped retry with no scheduler registration.
    assert!(matches!(
        log.timer_fired(fired, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));
    let rebound = log.rebind_connection(
        context(2)?,
        vec![PeerBinding {
            seat_id: seat(1)?,
            connection_generation: generation(2)?,
        }],
    )?;
    assert_eq!(deliver_count(&rebound.actions), 1);
    assert!(scheduler.live_timers().is_empty());
    assert!(
        log.dispose("scheduler-already-disposed", &mut scheduler)
            .is_empty()
    );
    assert!(log.diagnostics().disposed);
    assert!(log.retained().is_empty());
    assert!(log.dispose("idempotent", &mut scheduler).is_empty());
    Ok(())
}

#[test]
fn maximum_attempt_exhaustion_is_a_stopped_final_delivery_without_new_timer() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config_with_owner_and_attempts(
        8,
        &[(1, 1)],
        "authority-test",
        Some(2),
    )?)?;
    let committed = log.commit(draft("retry-cap")?, &mut scheduler)?;
    let first_id = scheduled_timer_id(&committed.actions).ok_or("missing first timer")?;
    let first_fired = scheduler.fired(first_id)?;

    let first_retry = log.timer_fired(first_fired.clone(), &mut scheduler)?;
    assert_eq!(
        scheduled_timer_id(&first_retry),
        Some(TimerId::new(safe(1)?))
    );
    assert_eq!(deliver_count(&first_retry), 1);
    let second_id = scheduled_timer_id(&first_retry).ok_or("missing second timer")?;
    assert_eq!(
        scheduler.timer(second_id).map(|timer| timer.delay_ms),
        Some(safe(500)?)
    );
    let second_fired = scheduler.fired(second_id)?;

    let terminal_actions = log.timer_fired(second_fired, &mut scheduler)?;
    assert!(scheduled_timer_id(&terminal_actions).is_none());
    assert_eq!(deliver_count(&terminal_actions), 1);
    assert!(scheduler.live_timers().is_empty());
    assert!(matches!(
        log.timer_fired(first_fired, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));
    Ok(())
}

#[test]
fn stopped_presentation_lease_redelivers_once_after_control() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config_with_owner_and_attempts(
        8,
        &[(1, 1)],
        "authority-test",
        Some(1),
    )?)?;
    let mut terminal_draft = draft("stopped-presentation")?;
    terminal_draft.kind = AuthorityEntryKind::TerminalCommit;
    terminal_draft.next_control = NextControl::Terminal(TerminalControl {
        terminal_id: "terminal/stopped-presentation".to_owned(),
    });
    let committed = log.commit(terminal_draft, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let exhausted = log.timer_fired(scheduler.fired(timer_id)?, &mut scheduler)?;
    assert_eq!(deliver_count(&exhausted), 1);
    assert!(scheduler.live_timers().is_empty());

    let control = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        control.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(1)?]
    ));
    assert_eq!(
        control.actions,
        vec![AuthorityLogAction::Deliver {
            to: seat(1)?,
            entry: Box::new(committed.entry.clone()),
        }]
    );

    let duplicate = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        duplicate.verdict,
        AuthorityReceiptVerdict::Duplicate {
            highest_stage: AckStage::ControlInstalled
        }
    ));
    assert!(duplicate.actions.is_empty());
    assert_eq!(
        log.retained_entry(committed.entry.revision),
        Some(&committed.entry)
    );
    Ok(())
}

#[test]
fn malformed_removed_timer_is_rejected_before_authority_mutation() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("timer-identity")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let removed = scheduler.fired(timer_id)?;
    let mut malformed = removed.clone();
    malformed.owner.reason = "wrong-owner".to_owned();
    let before = log.diagnostics();

    assert!(matches!(
        log.timer_fired(malformed, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));
    assert_eq!(log.diagnostics(), before);
    assert_eq!(
        log.retained_entry(committed.entry.revision),
        Some(&committed.entry)
    );
    Ok(())
}

#[test]
fn receipt_duplicates_and_stale_continuations_are_idempotent_or_rejected() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("receipt-order")?, &mut scheduler)?;

    let admitted = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert!(matches!(
        admitted.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, .. }
    ));
    let duplicate = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert!(matches!(
        duplicate.verdict,
        AuthorityReceiptVerdict::Duplicate {
            highest_stage: AckStage::Admitted
        }
    ));
    let presentation_first = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        presentation_first.verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::PresentationBeforeMechanical
        }
    ));
    let stale_generation = receipt(&committed.entry, 1, 0, AckStage::Admitted)?;
    assert!(matches!(
        log.accept_receipt_detailed(stale_generation, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::ConnectionGenerationMismatch
        }
    ));
    Ok(())
}

#[test]
fn receipt_authentication_checks_role_context_generation_revision_operation_and_control_id()
-> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("receipt-auth-all")?, &mut scheduler)?;
    let admitted = receipt(&committed.entry, 1, 1, AckStage::Admitted)?;

    let mut malformed = admitted.clone();
    malformed.revision = Revision::ZERO;
    assert!(matches!(
        log.accept_receipt_detailed(malformed, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::InvalidReceipt
        }
    ));

    let mut malformed_operation = admitted.clone();
    malformed_operation.operation_id = OperationId::new("bad\u{0001}")?;
    assert!(matches!(
        log.accept_receipt_detailed(malformed_operation, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::InvalidReceipt
        }
    ));

    let mut malformed_context = admitted.clone();
    malformed_context.context.seat_map_id.clear();
    assert!(matches!(
        log.accept_receipt_detailed(malformed_context, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::InvalidContext
        }
    ));

    let mut session_mismatch = admitted.clone();
    session_mismatch.context.session_id = SessionId::new("other-session")?;
    assert!(matches!(
        log.accept_receipt_detailed(session_mismatch, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::SessionMismatch
        }
    ));

    let mut epoch_mismatch = admitted.clone();
    epoch_mismatch.context.session_epoch = safe(2)?;
    assert!(matches!(
        log.accept_receipt_detailed(epoch_mismatch, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::StaleEpoch
        }
    ));

    let mut revision_mismatch = admitted.clone();
    revision_mismatch.revision = Revision::new(safe(2)?);
    assert!(matches!(
        log.accept_receipt_detailed(revision_mismatch, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::RevisionMismatch
        }
    ));

    let mut operation_mismatch = admitted.clone();
    operation_mismatch.operation_id = OperationId::new("other-operation")?;
    assert!(matches!(
        log.accept_receipt_detailed(operation_mismatch, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::OperationMismatch
        }
    ));

    let mut authority_mismatch = admitted.clone();
    authority_mismatch.context.authority_seat_id = seat(9)?;
    assert!(matches!(
        log.accept_receipt_detailed(authority_mismatch, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::AuthorityMismatch
        }
    ));

    let mut self_signed = admitted.clone();
    self_signed.context.sender_seat_id = seat(0)?;
    assert!(matches!(
        log.accept_receipt_detailed(self_signed, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::SelfSigned
        }
    ));

    let mut unbound_peer = admitted.clone();
    unbound_peer.context.sender_seat_id = seat(9)?;
    assert!(matches!(
        log.accept_receipt_detailed(unbound_peer, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::UnboundPeer
        }
    ));

    let mut membership_mismatch = admitted.clone();
    membership_mismatch.context.membership_revision = er_types::MembershipRevision::new(safe(2)?);
    assert!(matches!(
        log.accept_receipt_detailed(membership_mismatch, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::MembershipMismatch
        }
    ));

    let stale_generation = receipt(&committed.entry, 1, 0, AckStage::Admitted)?;
    assert!(matches!(
        log.accept_receipt_detailed(stale_generation, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::ConnectionGenerationMismatch
        }
    ));

    let mut unexpected_control_id = admitted.clone();
    unexpected_control_id.control_id = Some("unexpected-control".to_owned());
    assert!(matches!(
        log.accept_receipt_detailed(unexpected_control_id, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::UnexpectedControlId
        }
    ));

    let mut presentation_first = admitted.clone();
    presentation_first.stage = AckStage::PresentationSettled;
    assert!(matches!(
        log.accept_receipt_detailed(presentation_first, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::PresentationBeforeMechanical
        }
    ));

    let mut wrong_control_id = admitted.clone();
    wrong_control_id.stage = AckStage::ControlInstalled;
    wrong_control_id.control_id = Some("wrong-control".to_owned());
    assert!(matches!(
        log.accept_receipt_detailed(wrong_control_id, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::ControlIdMismatch
        }
    ));
    let mut missing_control_id = admitted.clone();
    missing_control_id.stage = AckStage::ControlInstalled;
    assert!(matches!(
        log.accept_receipt_detailed(missing_control_id, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::ControlIdMismatch
        }
    ));

    let advanced = log.accept_receipt_detailed(admitted.clone(), &mut scheduler);
    assert!(matches!(
        advanced.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            waiting_for_seat_ids
        } if waiting_for_seat_ids == vec![seat(1)?]
    ));
    let duplicate = log.accept_receipt_detailed(admitted, &mut scheduler);
    assert!(matches!(
        duplicate.verdict,
        AuthorityReceiptVerdict::Duplicate {
            highest_stage: AckStage::Admitted
        }
    ));

    let material = receipt(&committed.entry, 1, 1, AckStage::MaterialApplied)?;
    assert!(matches!(
        log.accept_receipt_detailed(material, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, .. }
    ));
    let control = receipt(&committed.entry, 1, 1, AckStage::ControlInstalled)?;
    assert_eq!(control.control_id.as_deref(), Some(control_id()));
    assert!(matches!(
        log.accept_receipt_detailed(control, &mut scheduler).verdict,
        AuthorityReceiptVerdict::Advanced { retired: true, .. }
    ));
    Ok(())
}

#[test]
fn full_peer_control_quorum_cancels_scheduler_timer() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1), (2, 1)])?)?;
    let committed = log.commit(draft("quorum")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;

    for peer in [1, 2] {
        let outcome = log.accept_receipt_detailed(
            receipt(&committed.entry, peer, 1, AckStage::ControlInstalled)?,
            &mut scheduler,
        );
        if peer == 1 {
            assert!(matches!(
                outcome.verdict,
                AuthorityReceiptVerdict::Advanced {
                    retired: false,
                    waiting_for_seat_ids,
                } if waiting_for_seat_ids == vec![seat(2)?]
            ));
        } else {
            assert!(matches!(
                outcome.verdict,
                AuthorityReceiptVerdict::Advanced {
                    retired: true,
                    waiting_for_seat_ids,
                } if waiting_for_seat_ids.is_empty()
            ));
        }
    }
    assert_eq!(scheduler.timer(timer_id), None);
    assert!(log.retained().is_empty());
    assert!(log.peer_stage_quorum(&committed.entry.operation_id, AckStage::ControlInstalled));
    Ok(())
}

#[test]
fn admitted_subsuming_entry_retires_only_the_subsumed_lease_and_cancels_its_timer() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1), (2, 1)])?)?;
    let first = log.commit(draft("subsumed")?, &mut scheduler)?;
    let mut successor = draft("subsummer")?;
    successor.subsumes = vec![first.entry.revision];
    let second = log.commit(successor, &mut scheduler)?;
    let first_timer = scheduled_timer_id(&first.actions).ok_or("missing first timer")?;
    let second_timer = scheduled_timer_id(&second.actions).ok_or("missing second timer")?;

    let first_peer = log.accept_receipt_detailed(
        receipt(&second.entry, 1, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert!(matches!(
        first_peer.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            waiting_for_seat_ids
        } if waiting_for_seat_ids == vec![seat(1)?, seat(2)?]
    ));
    assert!(scheduler.timer(first_timer).is_some());
    assert!(log.retained_entry(first.entry.revision).is_some());

    let second_peer = log.accept_receipt_detailed(
        receipt(&second.entry, 2, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert_eq!(
        second_peer
            .actions
            .iter()
            .filter(|action| matches!(
                action,
                AuthorityLogAction::Scheduler {
                    command: SchedulerCommand::Cancel { timer_id, .. }
                } if *timer_id == first_timer
            ))
            .count(),
        1
    );
    assert_eq!(
        log.retained()
            .iter()
            .map(|entry| entry.revision)
            .collect::<Vec<_>>(),
        vec![second.entry.revision]
    );
    assert_eq!(scheduler.timer(first_timer), None);
    assert!(scheduler.timer(second_timer).is_some());
    assert!(!log.peer_stage_quorum(&first.entry.operation_id, AckStage::Admitted));
    Ok(())
}

#[test]
fn recovery_slices_are_dense_and_equal_frontier_reconstructs_the_latest_entry() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    assert_eq!(
        log.recovery_slice(Revision::ZERO),
        Some(er_types::AuthorityRecoverySlice {
            frontier: Revision::ZERO,
            frontier_operation_id: None,
            next_control: None,
            required_tail: Vec::new(),
        })
    );

    let first = log.commit(draft("recovery-first")?, &mut scheduler)?;
    let second = log.commit(draft("recovery-second")?, &mut scheduler)?;
    let from_zero = log
        .recovery_slice(Revision::ZERO)
        .ok_or("missing dense slice")?;
    assert_eq!(from_zero.frontier, second.entry.revision);
    assert_eq!(
        from_zero.frontier_operation_id,
        Some(second.entry.operation_id.clone())
    );
    assert_eq!(
        from_zero.next_control,
        Some(second.entry.next_control.clone())
    );
    assert_eq!(
        from_zero.required_tail,
        vec![first.entry.clone(), second.entry.clone()]
    );

    let from_first = log
        .recovery_slice(first.entry.revision)
        .ok_or("missing one-entry tail")?;
    assert_eq!(from_first.required_tail, vec![second.entry.clone()]);
    let equal = log
        .recovery_slice(second.entry.revision)
        .ok_or("missing equal-frontier reconstruction")?;
    assert_eq!(equal.required_tail, vec![second.entry.clone()]);
    assert!(log.recovery_slice(Revision::new(safe(3)?)).is_none());

    // Retirement removes the old lease, so a lower request is no longer dense, while the equal frontier
    // remains a valid one-entry reconstruction proof from latest_committed.
    for entry in [&first.entry, &second.entry] {
        for stage in [
            AckStage::Admitted,
            AckStage::MaterialApplied,
            AckStage::ControlInstalled,
        ] {
            let outcome = log.accept_receipt_detailed(receipt(entry, 1, 1, stage)?, &mut scheduler);
            if stage == AckStage::ControlInstalled {
                assert!(matches!(
                    outcome.verdict,
                    AuthorityReceiptVerdict::Advanced { retired: true, .. }
                ));
            }
        }
    }
    assert!(log.recovery_slice(Revision::ZERO).is_none());
    let equal_after_retirement = log
        .recovery_slice(second.entry.revision)
        .ok_or("missing equal proof after retirement")?;
    assert_eq!(
        equal_after_retirement.required_tail,
        vec![second.entry.clone()]
    );
    Ok(())
}

#[test]
fn rebind_preserves_live_timer_and_replays_each_retained_entry_to_each_peer() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1), (2, 1)])?)?;
    let committed = log.commit(draft("rebind")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let timer_before = scheduler.timer(timer_id).cloned().ok_or("timer not live")?;
    let _ = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    let before_rebind_log = log.clone();

    let outcome = log.rebind_connection(
        context(2)?,
        vec![
            PeerBinding {
                seat_id: seat(1)?,
                connection_generation: generation(2)?,
            },
            PeerBinding {
                seat_id: seat(2)?,
                connection_generation: generation(2)?,
            },
        ],
    )?;
    assert_eq!(outcome.retained_count, safe(1)?);
    assert_eq!(deliver_count(&outcome.actions), 2);
    assert!(scheduler_commands(&outcome.actions).is_empty());
    assert_eq!(scheduler.timer(timer_id), Some(&timer_before));
    assert_eq!(log.diagnostics().delivery_timer_ids.len(), 1);
    assert_eq!(
        log.retained_entry(committed.entry.revision)
            .ok_or("retained entry missing")?
            .context,
        context(2)?,
    );
    assert_eq!(
        before_rebind_log
            .retained_entry(committed.entry.revision)
            .ok_or("cloned retained entry missing")?
            .context,
        context(1)?,
        "rebind mutated a copy-on-write predecessor log",
    );
    assert_eq!(
        before_rebind_log
            .recovery_slice(committed.entry.revision)
            .ok_or("cloned recovery frontier missing")?
            .required_tail[0]
            .context
            .clone(),
        context(1)?,
        "rebind mutated a copy-on-write latest-commit proof",
    );
    assert_eq!(
        log.recovery_slice(committed.entry.revision)
            .ok_or("rebound recovery frontier missing")?
            .required_tail[0]
            .context
            .clone(),
        context(2)?,
    );

    let old_generation = receipt(
        log.retained_entry(committed.entry.revision)
            .ok_or("retained entry missing")?,
        2,
        1,
        AckStage::Admitted,
    )?;
    assert!(matches!(
        log.accept_receipt_detailed(old_generation, &mut scheduler)
            .verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::ConnectionGenerationMismatch
        }
    ));
    Ok(())
}

#[test]
fn rebind_preserves_retry_timer_delay_attempt_progress_and_peer_stage() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("rebind-progress")?, &mut scheduler)?;
    let first_id = scheduled_timer_id(&committed.actions).ok_or("missing first timer")?;
    let first_fired = scheduler.fired(first_id)?;
    let retry_actions = log.timer_fired(first_fired, &mut scheduler)?;
    let retry_id = scheduled_timer_id(&retry_actions).ok_or("missing retry timer")?;
    let retry_timer_before = scheduler
        .timer(retry_id)
        .cloned()
        .ok_or("retry timer not live")?;
    assert_eq!(retry_timer_before.delay_ms, safe(500)?);

    let admitted = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert!(matches!(
        admitted.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, .. }
    ));
    let before_rebind = log.diagnostics();
    let peer_one = seat(1)?;
    assert_eq!(
        before_rebind.peer_stages[&committed.entry.revision][&peer_one],
        AckStage::Admitted
    );

    let rebound = log.rebind_connection(
        context(2)?,
        vec![PeerBinding {
            seat_id: seat(1)?,
            connection_generation: generation(2)?,
        }],
    )?;
    assert_eq!(deliver_count(&rebound.actions), 1);
    assert!(scheduler_commands(&rebound.actions).is_empty());
    assert_eq!(scheduler.timer(retry_id), Some(&retry_timer_before));
    let after_rebind = log.diagnostics();
    assert_eq!(
        after_rebind.delivery_timer_ids,
        before_rebind.delivery_timer_ids
    );
    assert_eq!(
        after_rebind.peer_stages[&committed.entry.revision][&peer_one],
        AckStage::Admitted
    );
    let rebound_entry = log
        .retained_entry(committed.entry.revision)
        .ok_or("retained entry missing")?;
    assert_eq!(rebound_entry.context, context(2)?);
    Ok(())
}

#[test]
fn invalid_rebind_is_atomic_and_unchanged_rebind_is_a_noop() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("rebind-atomic")?, &mut scheduler)?;
    let before_diagnostics = log.diagnostics();
    let before_entry = committed.entry.clone();
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let before_timer = scheduler.timer(timer_id).cloned().ok_or("timer not live")?;

    let invalid = log.rebind_connection(
        context(0)?,
        vec![PeerBinding {
            seat_id: seat(1)?,
            connection_generation: generation(1)?,
        }],
    );
    assert!(matches!(
        invalid,
        Err(AuthorityLogError::InvalidConfig { .. })
    ));
    assert_eq!(log.diagnostics(), before_diagnostics);
    assert_eq!(
        log.retained_entry(before_entry.revision),
        Some(&before_entry)
    );
    assert_eq!(scheduler.timer(timer_id), Some(&before_timer));

    let unchanged = log.rebind_connection(
        context(1)?,
        vec![PeerBinding {
            seat_id: seat(1)?,
            connection_generation: generation(1)?,
        }],
    )?;
    assert_eq!(unchanged.retained_count, SafeU53::ZERO);
    assert!(unchanged.actions.is_empty());
    Ok(())
}

#[test]
fn retention_refusal_does_not_burn_revision_and_dispose_cancels_through_scheduler() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(1, &[(1, 1)])?)?;
    let first = log.commit(draft("retained")?, &mut scheduler)?;
    let refused = log.commit(draft("refused")?, &mut scheduler);
    assert!(matches!(
        refused,
        Err(AuthorityLogError::RetentionOverflow {
            attempted_revision,
            ..
        }) if attempted_revision == Revision::new(safe(2)?)
    ));
    assert_eq!(log.head_revision(), Revision::new(safe(1)?));
    assert_eq!(log.diagnostics().capacity_refusals, safe(1)?);

    let (retired, cancel_actions) = log.accept_receipt(
        receipt(&first.entry, 1, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(retired);
    assert_eq!(
        cancel_actions
            .iter()
            .filter(|action| matches!(
                action,
                AuthorityLogAction::Scheduler {
                    command: SchedulerCommand::Cancel { .. }
                }
            ))
            .count(),
        1
    );
    let second = log.commit(draft("revision-reused")?, &mut scheduler)?;
    assert_eq!(second.entry.revision, Revision::new(safe(2)?));

    let dispose_actions = log.dispose("teardown", &mut scheduler);
    assert_eq!(
        dispose_actions
            .iter()
            .filter(|action| matches!(
                action,
                AuthorityLogAction::Scheduler {
                    command: SchedulerCommand::Cancel { .. }
                }
            ))
            .count(),
        1
    );
    assert!(scheduler.live_timers().is_empty());
    assert!(log.dispose("again", &mut scheduler).is_empty());
    assert!(log.diagnostics().disposed);
    Ok(())
}

#[test]
fn maximum_timer_id_is_a_valid_identity_boundary_for_stale_events() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("max-boundary")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing timer")?;
    let removed = scheduler.fired(timer_id)?;
    let mut boundary = removed.clone();
    boundary.timer_id = TimerId::new(SafeU53::MAX);
    let before = log.diagnostics();

    assert!(matches!(
        log.timer_fired(boundary, &mut scheduler),
        Err(AuthorityLogError::InvalidEntry { .. })
    ));
    assert_eq!(log.diagnostics(), before);
    Ok(())
}

#[test]
fn snapshot_rejects_divergent_retained_head_but_restores_retired_head_continuity() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config(8, &[(1, 1)])?)?;
    let committed = log.commit(draft("snapshot-head")?, &mut scheduler)?;
    let snapshot = log.snapshot_v2()?;
    snapshot.validate()?;

    let mut divergent = snapshot.clone();
    let mut divergent_entry = committed.entry.clone();
    divergent_entry.material.payload = json!({
        "operation": "snapshot-head-divergent",
        "epoch": 1,
        "wave": 1,
        "turn": 1,
    });
    let divergent_bytes = er_canonical::canonical_bytes(&divergent_entry)?;
    let retained = divergent
        .retained
        .first_mut()
        .ok_or("snapshot did not retain its head entry")?;
    retained.entry.canonical_entry_bytes = CanonicalHexBytes::from_bytes(&divergent_bytes);
    divergent.validate()?;
    assert_ne!(
        divergent.retained[0].entry.canonical_entry_bytes.as_str(),
        snapshot
            .latest_committed
            .as_ref()
            .ok_or("snapshot did not retain latest_committed")?
            .canonical_entry_bytes
            .as_str()
    );

    let mut valid_scheduler = scheduler.clone();
    let restored = AuthorityLog::from_snapshot_v2(snapshot.clone(), &mut valid_scheduler)?;
    assert_eq!(
        restored.retained_entry(committed.entry.revision),
        Some(&committed.entry)
    );
    let recovery = restored
        .recovery_slice(restored.head_revision())
        .ok_or("restored head continuity proof is missing")?;
    assert_eq!(recovery.required_tail, vec![committed.entry.clone()]);

    let mut divergent_scheduler = scheduler.clone();
    let error = AuthorityLog::from_snapshot_v2(divergent, &mut divergent_scheduler)
        .expect_err("a divergent retained head must be rejected");
    assert!(matches!(
        error,
        SnapshotError::Invalid { path, reason }
            if path == "authority_log.retained.entry"
                && reason == "retained head entry must equal latest_committed as a complete AuthorityEntry"
    ));

    let mut retired_log = log;
    let _ = retired_log.accept_receipt(
        receipt(&committed.entry, 1, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    let retired_snapshot = retired_log.snapshot_v2()?;
    assert!(retired_snapshot.retained.is_empty());
    let mut retired_scheduler = scheduler.clone();
    let retired = AuthorityLog::from_snapshot_v2(retired_snapshot, &mut retired_scheduler)?;
    assert!(retired.retained_entry(committed.entry.revision).is_none());
    assert_eq!(
        retired
            .recovery_slice(retired.head_revision())
            .ok_or("retired head continuity proof is missing")?
            .required_tail,
        vec![committed.entry]
    );
    Ok(())
}
