use std::error::Error;

use er_protocol::{
    AckStage, AuthorityEntry, AuthorityEntryDraft, AuthorityEntryKind, AuthorityLog,
    AuthorityLogAction, AuthorityLogConfig, AuthorityReceiptVerdict, BackoffPolicy, FrameContext,
    KernelScheduler, Material, NextControl, PeerBinding, ReceiptRejectReason, SchedulerCommand,
    TimeClass, build_battle_terminal_commit_draft, control_id_of,
};
use er_types::{
    AuthorityReceipt, AwaitSuccessorControl, CommandControlTarget, CommandFrontierControl,
    ConnectionGeneration, MembershipRevision, OperationId, Revision, RunId, SafeU53, SeatId,
    SessionId, TimerId,
};
use serde_json::json;

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> Result<SeatId, Box<dyn Error>> {
    Ok(SeatId::new(safe(value)?))
}

fn context() -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m3-terminal-authority")?,
        run_id: RunId::new("m3-terminal-run")?,
        session_epoch: safe(1)?,
        seat_map_id: "m3-terminal-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)?),
        sender_seat_id: seat(0)?,
        authority_seat_id: seat(0)?,
        connection_generation: ConnectionGeneration::new(safe(1)?),
    })
}

fn config() -> Result<AuthorityLogConfig, Box<dyn Error>> {
    Ok(AuthorityLogConfig {
        local_context: context()?,
        peer_bindings: vec![
            PeerBinding {
                seat_id: seat(1)?,
                connection_generation: ConnectionGeneration::new(safe(1)?),
            },
            PeerBinding {
                seat_id: seat(2)?,
                connection_generation: ConnectionGeneration::new(safe(1)?),
            },
        ],
        owner_id: "m3-terminal-authority-log".to_owned(),
        retain_capacity: safe(8)?,
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250)?,
            maximum_ms: safe(5_000)?,
            factor_numerator: safe(2)?,
            factor_denominator: safe(1)?,
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: None,
    })
}

fn ordinary_draft(operation: &str) -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    Ok(AuthorityEntryDraft {
        context: context()?,
        operation_id: OperationId::new(operation)?,
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: format!("digest-{operation}"),
            payload: json!({
                "epoch": 1,
                "wave": 1,
                "turn": 1,
            }),
        },
        next_control: NextControl::CommandFrontier(CommandFrontierControl {
            epoch: safe(1)?,
            wave: safe(1)?,
            turn: safe(1)?,
            commands: vec![CommandControlTarget {
                owner_seat_id: seat(0)?,
                pokemon_id: safe(1)?,
                field_index: safe(0)?,
            }],
        }),
        subsumes: Vec::new(),
    })
}

fn final_predecessor_draft() -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    Ok(AuthorityEntryDraft {
        context: context()?,
        operation_id: OperationId::new("battle/final-predecessor")?,
        kind: AuthorityEntryKind::TurnCommit,
        material: Material {
            digest: "digest-final-predecessor".to_owned(),
            payload: json!({
                "epoch": 1,
                "wave": 2,
                "turn": 3,
            }),
        },
        next_control: NextControl::AwaitSuccessor(AwaitSuccessorControl {
            after_operation_id: OperationId::new("battle/final-predecessor")?,
            epoch: safe(1)?,
            wave: safe(2)?,
            turn: safe(3)?,
            allowed_kinds: vec![AuthorityEntryKind::TerminalCommit],
            allowed_interaction_addresses: None,
            allowed_control_addresses: None,
            allow_next_wave_start: false,
            expected_operation_id: Some(OperationId::new("battle/final-terminal")?),
        }),
        subsumes: Vec::new(),
    })
}

fn terminal_draft(subsumes: Vec<Revision>) -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    let terminal = er_protocol::BattleTerminalMaterialV1::new(
        "m3-terminal",
        er_protocol::BattleTerminalReasonV1::GameOver,
        2_u64,
        3_u64,
    )?;
    Ok(build_battle_terminal_commit_draft(
        context()?,
        OperationId::new("battle/final-terminal")?,
        terminal,
        subsumes,
    )?)
}

fn receipt(
    entry: &AuthorityEntry,
    peer: u64,
    stage: AckStage,
) -> Result<AuthorityReceipt, Box<dyn Error>> {
    let mut receipt_context = entry.context.clone();
    receipt_context.sender_seat_id = seat(peer)?;
    receipt_context.connection_generation = ConnectionGeneration::new(safe(1)?);
    Ok(AuthorityReceipt {
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

fn cancel_count(actions: &[AuthorityLogAction], timer_id: TimerId) -> usize {
    actions
        .iter()
        .filter(|action| {
            matches!(
                action,
                AuthorityLogAction::Scheduler {
                    command: SchedulerCommand::Cancel {
                        timer_id: cancelled,
                        ..
                    }
                } if *cancelled == timer_id
            )
        })
        .count()
}

#[test]
fn ordinary_entries_still_retire_at_full_control_quorum() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config()?)?;
    let committed = log.commit(ordinary_draft("ordinary-control")?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&committed.actions).ok_or("missing ordinary timer")?;

    let first = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        first.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(2)?]
    ));

    let second = log.accept_receipt_detailed(
        receipt(&committed.entry, 2, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        second.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: true,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.is_empty()
    ));
    assert!(log.retained().is_empty());
    assert_eq!(scheduler.timer(timer_id), None);
    assert_eq!(cancel_count(&second.actions, timer_id), 1);
    assert!(log.peer_stage_quorum(&committed.entry.operation_id, AckStage::ControlInstalled));
    assert!(!log.peer_stage_quorum(&committed.entry.operation_id, AckStage::PresentationSettled));
    Ok(())
}

#[test]
fn mixed_await_successors_keep_ordinary_control_retirement() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config()?)?;
    let mut draft = final_predecessor_draft()?;
    let NextControl::AwaitSuccessor(control) = &mut draft.next_control else {
        return Err("final predecessor helper did not create an await control".into());
    };
    control.allowed_kinds = vec![
        AuthorityEntryKind::WaveAdvance,
        AuthorityEntryKind::TerminalCommit,
    ];
    control.allow_next_wave_start = true;
    control.expected_operation_id = None;
    let committed = log.commit(draft, &mut scheduler)?;

    let first = log.accept_receipt_detailed(
        receipt(&committed.entry, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        first.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(2)?]
    ));
    let second = log.accept_receipt_detailed(
        receipt(&committed.entry, 2, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        second.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: true,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.is_empty()
    ));
    assert!(log.retained().is_empty());
    Ok(())
}

#[test]
fn final_predecessor_survives_presentation_until_terminal_subsumption() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config()?)?;
    let predecessor = log.commit(final_predecessor_draft()?, &mut scheduler)?;
    let predecessor_timer =
        scheduled_timer_id(&predecessor.actions).ok_or("missing predecessor timer")?;

    for peer in [1, 2] {
        let outcome = log.accept_receipt_detailed(
            receipt(&predecessor.entry, peer, AckStage::ControlInstalled)?,
            &mut scheduler,
        );
        assert!(matches!(
            outcome.verdict,
            AuthorityReceiptVerdict::Advanced {
                retired: false,
                ref waiting_for_seat_ids,
            } if waiting_for_seat_ids.as_slice() == [seat(1)?, seat(2)?]
        ));
    }
    assert!(log.peer_stage_quorum(&predecessor.entry.operation_id, AckStage::ControlInstalled));
    assert!(!log.peer_stage_quorum(
        &predecessor.entry.operation_id,
        AckStage::PresentationSettled
    ));

    let settled_one = log.accept_receipt_detailed(
        receipt(&predecessor.entry, 1, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        settled_one.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(2)?]
    ));
    let settled_two = log.accept_receipt_detailed(
        receipt(&predecessor.entry, 2, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        settled_two.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.is_empty()
    ));
    assert!(log.retained_entry(predecessor.entry.revision).is_some());
    assert!(log.peer_stage_quorum(
        &predecessor.entry.operation_id,
        AckStage::PresentationSettled
    ));

    let terminal = log.commit(
        terminal_draft(vec![predecessor.entry.revision])?,
        &mut scheduler,
    )?;
    let terminal_admitted_one = log.accept_receipt_detailed(
        receipt(&terminal.entry, 1, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert!(matches!(
        terminal_admitted_one.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(1)?, seat(2)?]
    ));
    let terminal_admitted_two = log.accept_receipt_detailed(
        receipt(&terminal.entry, 2, AckStage::Admitted)?,
        &mut scheduler,
    );
    assert!(matches!(
        terminal_admitted_two.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(1)?, seat(2)?]
    ));
    assert_eq!(
        cancel_count(&terminal_admitted_two.actions, predecessor_timer),
        1
    );
    assert_eq!(scheduler.timer(predecessor_timer), None);
    assert!(log.retained_entry(predecessor.entry.revision).is_none());
    assert!(log.retained_entry(terminal.entry.revision).is_some());
    assert!(log.peer_stage_quorum(
        &predecessor.entry.operation_id,
        AckStage::PresentationSettled
    ));
    assert!(log.peer_stage_quorum(&terminal.entry.operation_id, AckStage::Admitted));
    Ok(())
}

#[test]
fn terminal_waits_for_presentation_and_receipts_are_fail_closed_or_idempotent() -> TestResult {
    let mut scheduler = KernelScheduler::new();
    let mut log = AuthorityLog::new(config()?)?;
    let terminal = log.commit(terminal_draft(Vec::new())?, &mut scheduler)?;
    let timer_id = scheduled_timer_id(&terminal.actions).ok_or("missing terminal timer")?;

    let presentation_first = log.accept_receipt_detailed(
        receipt(&terminal.entry, 1, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        presentation_first.verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::PresentationBeforeMechanical
        }
    ));

    let control_one = log.accept_receipt_detailed(
        receipt(&terminal.entry, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        control_one.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(1)?, seat(2)?]
    ));
    let duplicate_control = log.accept_receipt_detailed(
        receipt(&terminal.entry, 1, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        duplicate_control.verdict,
        AuthorityReceiptVerdict::Duplicate {
            highest_stage: AckStage::ControlInstalled
        }
    ));

    let control_two = log.accept_receipt_detailed(
        receipt(&terminal.entry, 2, AckStage::ControlInstalled)?,
        &mut scheduler,
    );
    assert!(matches!(
        control_two.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(1)?, seat(2)?]
    ));
    assert!(log.peer_stage_quorum(&terminal.entry.operation_id, AckStage::ControlInstalled));
    assert!(!log.peer_stage_quorum(&terminal.entry.operation_id, AckStage::PresentationSettled));

    let settled_one = log.accept_receipt_detailed(
        receipt(&terminal.entry, 1, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        settled_one.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: false,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.as_slice() == [seat(2)?]
    ));
    let settled_two = log.accept_receipt_detailed(
        receipt(&terminal.entry, 2, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        settled_two.verdict,
        AuthorityReceiptVerdict::Advanced {
            retired: true,
            ref waiting_for_seat_ids,
        } if waiting_for_seat_ids.is_empty()
    ));
    assert_eq!(cancel_count(&settled_two.actions, timer_id), 1);
    assert_eq!(scheduler.timer(timer_id), None);
    assert!(log.peer_stage_quorum(&terminal.entry.operation_id, AckStage::PresentationSettled));

    let stale_after_retirement = log.accept_receipt_detailed(
        receipt(&terminal.entry, 2, AckStage::PresentationSettled)?,
        &mut scheduler,
    );
    assert!(matches!(
        stale_after_retirement.verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::RevisionMismatch
        }
    ));
    Ok(())
}
