#![allow(clippy::panic)]
// Deterministic property-test assertion helpers intentionally panic on impossible observed action shapes
// so seeded counterexamples report the exact operation and state.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::panic::{AssertUnwindSafe, catch_unwind};

use er_protocol::{
    AuthorityEntryDraft, AuthorityLog, AuthorityLogAction, AuthorityLogConfig,
    AuthorityReceiptVerdict, AuthorityReplica, AuthorityReplicaConfig, BackoffPolicy,
    ControlProjectionOutcome, FrameValidator, InboundFrameResult, KernelScheduler,
    PresentationProbeOutcome, ProposalAdmission, ProposalAdmissionLedger, ProposalFingerprintInput,
    ProposalIdentity, ProposalJson, ProposalLeaseAction, ProposalLeaseConfig, ProposalLeaseManager,
    ProposalLeaseSpec, ProposalLeaseStart, ProposalMessage, ReceiptRejectReason, RecoveryAction,
    RecoveryBundleValidation, RecoveryError, RecoveryFence, RecoveryFenceState,
    RecoveryFrontierStagingOutcome, RecoveryLiveState, RecoveryMaterialOutcome,
    RecoveryTransaction, RecoveryTransactionConfig, RecoveryValidationContext, ReplicaAction,
    ReplicaAdmission, ReplicaMechanicalStage, ReplicaRejectReason, ReplicaResume, ScheduledTimer,
    SchedulerCommand, SchedulerError, SuccessorValidator, TimerSpec, ValidatedFrameBody,
    control_allows_successor_entry, control_id_of, control_owner_seat_id, control_owner_seat_ids,
    controls_equal, fingerprint_bargain, fingerprint_biome_shop_buy, fingerprint_biome_shop_leave,
    fingerprint_reward, frame_context_issues, frame_contexts_compatible, frame_contexts_equal,
    is_valid_next_control, next_control_issues, partition_control_for_seat, proposal_fingerprint,
    same_control_address, successor_wait_allows, successor_wait_allows_local_presentation_input,
    validate_inbound_frame, validate_next_control,
};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AuthorityReceipt,
    AwaitSuccessorControl, CommandControlTarget, CommandFrontierControl, ConnectionGeneration,
    FrameContext, FrameType, InteractionSuccessor, Material, MaterialApplicationOutcome,
    MembershipRevision, NextControl, OperationId, RawFrame, RecoveryBundle, RecoveryPhase,
    Revision, RunId, SafeI53, SafeU53, SeatId, SessionId, SharedInteractionControl,
    TerminalControl, TimeClass, TimerId, TimerOwner, validate_authority_material_digest,
    validate_authority_operation_id,
};
use serde_json::{Map, Value, json};

type TestResult = Result<(), Box<dyn Error>>;

// These are frozen M2 wire/runtime values. They intentionally remain local
// golden expectations instead of importing the production defaults into the
// property oracle.
const GOLDEN_DELIVERY_INITIAL_MS: u64 = 250;
const GOLDEN_DELIVERY_MAX_MS: u64 = 5_000;
const GOLDEN_DELIVERY_MAX_ATTEMPTS: u64 = 4;
const GOLDEN_RECOVERY_REQUEST_TIMEOUT_MS: u64 = 300_000;
const GOLDEN_RECOVERY_CONTROL_TIMEOUT_MS: u64 = 30_000;
const GOLDEN_RECOVERY_PACING_MS: u64 = 16;
const GOLDEN_PROPOSAL_RETRY_INITIAL_MS: u64 = 250;
const GOLDEN_PROPOSAL_RETRY_MAX_MS: u64 = 5_000;
const GOLDEN_PROPOSAL_ABSOLUTE_CEILING_MS: u64 = 1_200_000;
const GOLDEN_PROPOSAL_TEST_CEILING_MS: u64 = 1_000;
const GOLDEN_AUTHORITY_STRING_UTF16_LIMIT: usize = 256;
const GOLDEN_AUTHORITY_CONTROL_ID: &str = "COMMAND_FRONTIER/e3/w4/t1/f0:s0:p7";
const GOLDEN_REPLICA_CONTROL_ID: &str = "COMMAND_FRONTIER/e3/w4/t1/f0:s1:p42";
const GOLDEN_MAX_CONTROL_ID: &str = "COMMAND_FRONTIER/e9007199254740991/w9007199254740991/t9007199254740991/f9007199254740991:s9007199254740991:p9007199254740991";

fn missing(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(std::io::Error::other(message.into()))
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value)
        .unwrap_or_else(|error| panic!("SafeU53 helper received invalid value {value}: {error}"))
}

fn signed(value: i64) -> SafeI53 {
    SafeI53::new(value)
        .unwrap_or_else(|error| panic!("SafeI53 helper received invalid value {value}: {error}"))
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn operation(value: &str) -> Result<OperationId, Box<dyn Error>> {
    Ok(OperationId::new(value)?)
}

fn session(value: &str) -> Result<SessionId, Box<dyn Error>> {
    Ok(SessionId::new(value)?)
}

fn run(value: &str) -> Result<RunId, Box<dyn Error>> {
    Ok(RunId::new(value)?)
}

fn context(
    sender_seat_id: u64,
    authority_seat_id: u64,
    membership_revision: u64,
    connection_generation: u64,
    session_epoch: u64,
) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: session("session-1")?,
        run_id: run("run-1")?,
        session_epoch: safe(session_epoch),
        seat_map_id: "seat-map-1".to_owned(),
        membership_revision: MembershipRevision::new(safe(membership_revision)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(authority_seat_id),
        connection_generation: generation(connection_generation),
    })
}

fn authority_context() -> Result<FrameContext, Box<dyn Error>> {
    context(0, 0, 2, 1, 3)
}

fn replica_context() -> Result<FrameContext, Box<dyn Error>> {
    context(1, 0, 2, 2, 3)
}

fn timer_owner(owner_id: &str, address: &str, reason: &str) -> TimerOwner {
    TimerOwner {
        owner_id: owner_id.to_owned(),
        address: address.to_owned(),
        reason: reason.to_owned(),
    }
}

fn command_target(field_index: u64, owner_seat_id: u64, pokemon_id: u64) -> CommandControlTarget {
    CommandControlTarget {
        owner_seat_id: seat(owner_seat_id),
        pokemon_id: safe(pokemon_id),
        field_index: safe(field_index),
    }
}

fn command_control(
    epoch: u64,
    wave: u64,
    turn: u64,
    commands: Vec<CommandControlTarget>,
) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(epoch),
        wave: safe(wave),
        turn: safe(turn),
        commands,
    })
}

fn replacement_control(head: &str) -> Result<NextControl, Box<dyn Error>> {
    Ok(NextControl::Replacement(er_types::ReplacementControl {
        operation_id: operation(head)?,
        owner_seat_id: seat(0),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        occurrence: safe(0),
        field_index: safe(0),
        remaining: vec![
            er_types::ReplacementControlAddress {
                operation_id: operation("replacement/tail/1")?,
                owner_seat_id: seat(1),
                epoch: safe(1),
                wave: safe(2),
                turn: safe(3),
                occurrence: safe(1),
                field_index: safe(1),
            },
            er_types::ReplacementControlAddress {
                operation_id: operation("replacement/tail/2")?,
                owner_seat_id: seat(0),
                epoch: safe(1),
                wave: safe(2),
                turn: safe(3),
                occurrence: safe(2),
                field_index: safe(2),
            },
        ],
    }))
}

fn replay<T, E: std::fmt::Display>(
    seed: u64,
    operation: impl AsRef<str>,
    result: Result<T, E>,
) -> Result<T, Box<dyn Error>> {
    result.map_err(|error| {
        missing(format!(
            "seed={seed} operation={}: {error}",
            operation.as_ref()
        ))
    })
}

fn shared_control(
    operation_kind: &str,
    operation_ids: Option<Vec<OperationId>>,
) -> Result<NextControl, Box<dyn Error>> {
    Ok(NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/current")?,
        owner_seat_id: seat(1),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        surface_class: "op:reward".to_owned(),
        operation_kind: operation_kind.to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned(), "REWARD_PRESENT".to_owned()],
            operation_ids,
        },
    }))
}

fn await_control() -> Result<NextControl, Box<dyn Error>> {
    Ok(NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id: operation("predecessor")?,
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        allowed_kinds: vec![
            AuthorityEntryKind::ControlCommit,
            AuthorityEntryKind::InteractionCommit,
            AuthorityEntryKind::WaveAdvance,
            AuthorityEntryKind::TerminalCommit,
        ],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: true,
        expected_operation_id: None,
    }))
}

fn terminal_control(value: &str) -> NextControl {
    NextControl::Terminal(TerminalControl {
        terminal_id: value.to_owned(),
    })
}

fn authority_entry(
    frame_context: &FrameContext,
    revision_value: u64,
    operation_value: &str,
    kind: AuthorityEntryKind,
    payload: Value,
    next_control: NextControl,
) -> Result<AuthorityEntry, Box<dyn Error>> {
    Ok(AuthorityEntry {
        context: frame_context.clone(),
        revision: revision(revision_value),
        operation_id: operation(operation_value)?,
        kind,
        material: Material {
            digest: format!("digest-{operation_value}"),
            payload,
        },
        next_control,
        subsumes: Vec::new(),
    })
}

fn draft(
    frame_context: &FrameContext,
    operation_value: &str,
    kind: AuthorityEntryKind,
    payload: Value,
    next_control: NextControl,
) -> Result<AuthorityEntryDraft, Box<dyn Error>> {
    Ok(AuthorityEntryDraft {
        context: frame_context.clone(),
        operation_id: operation(operation_value)?,
        kind,
        material: Material {
            digest: format!("digest-{operation_value}"),
            payload,
        },
        next_control,
        subsumes: Vec::new(),
    })
}

fn authority_log(
    capacity: u64,
    peer_generations: &[(u64, u64)],
) -> Result<AuthorityLog, Box<dyn Error>> {
    let peer_bindings = peer_generations
        .iter()
        .map(|(peer, peer_generation)| er_protocol::PeerBinding {
            seat_id: seat(*peer),
            connection_generation: generation(*peer_generation),
        })
        .collect();
    Ok(AuthorityLog::new(AuthorityLogConfig {
        local_context: authority_context()?,
        peer_bindings,
        owner_id: "authority-v2-property".to_owned(),
        retain_capacity: safe(capacity),
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(GOLDEN_DELIVERY_INITIAL_MS),
            maximum_ms: safe(GOLDEN_DELIVERY_MAX_MS),
            factor_numerator: safe(2),
            factor_denominator: safe(1),
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: Some(safe(GOLDEN_DELIVERY_MAX_ATTEMPTS)),
    })?)
}

fn receipt_for(
    entry: &AuthorityEntry,
    sender_seat_id: u64,
    connection_generation: u64,
    stage: AckStage,
    control_id: Option<String>,
) -> Result<AuthorityReceipt, Box<dyn Error>> {
    Ok(AuthorityReceipt {
        context: context(
            sender_seat_id,
            entry.context.authority_seat_id.get().get(),
            entry.context.membership_revision.get().get(),
            connection_generation,
            entry.context.session_epoch.get(),
        )?,
        revision: entry.revision,
        operation_id: entry.operation_id.clone(),
        stage,
        control_id,
    })
}

fn replica() -> Result<AuthorityReplica, Box<dyn Error>> {
    Ok(AuthorityReplica::new(AuthorityReplicaConfig {
        receipt_context: replica_context()?,
        authority_seat_id: seat(0),
        authority_connection_generation: generation(1),
    })?)
}

fn assert_replica_frontier_invariants(replica: &AuthorityReplica, seed: u64, stage: &str) {
    let frontier = replica.frontier();
    assert!(
        frontier.received >= frontier.material && frontier.material >= frontier.control,
        "seed={seed} operation={stage} frontier order: {:?}",
        frontier
    );
    match replica.pending_entry() {
        Some(entry) => {
            assert_eq!(
                entry.revision, frontier.received,
                "seed={seed} operation={stage} pending entry is not the received frontier"
            );
            assert!(
                frontier.control < frontier.received,
                "seed={seed} operation={stage} pending entry coexists with a complete control frontier"
            );
            assert!(
                frontier.material == frontier.control || frontier.material == frontier.received,
                "seed={seed} operation={stage} pending entry has a non-stage frontier: {:?}",
                frontier
            );
        }
        None => assert_eq!(
            frontier.received, frontier.control,
            "seed={seed} operation={stage} no pending entry but control frontier is incomplete"
        ),
    }
}

fn replica_entry(
    revision_value: u64,
    operation_value: &str,
) -> Result<AuthorityEntry, Box<dyn Error>> {
    authority_entry(
        &authority_context()?,
        revision_value,
        operation_value,
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 1, 42)]),
    )
}

fn recovered_bundle(captured: u64, frontier: u64) -> Result<RecoveryBundle, Box<dyn Error>> {
    let frame_context = authority_context()?;
    let mut required_tail = Vec::new();
    if frontier > captured {
        for value in (captured + 1)..=frontier {
            required_tail.push(authority_entry(
                &frame_context,
                value,
                &format!("operation-{value}"),
                AuthorityEntryKind::TurnCommit,
                Value::Null,
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            )?);
        }
    } else if frontier > 0 {
        required_tail.push(authority_entry(
            &frame_context,
            frontier,
            &format!("operation-{frontier}"),
            AuthorityEntryKind::TurnCommit,
            Value::Null,
            command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
        )?);
    }
    let last = required_tail.last();
    Ok(RecoveryBundle {
        request_id: "recovery-1".to_owned(),
        context: frame_context,
        material: Material {
            digest: "material-digest".to_owned(),
            payload: json!({"hp": 42}),
        },
        frontier: revision(frontier),
        frontier_operation_id: last.map(|entry| entry.operation_id.clone()),
        membership_revision: MembershipRevision::new(safe(2)),
        next_control: last.map(|entry| entry.next_control.clone()),
        required_tail,
    })
}

fn recovery_validation_context(captured: u64) -> Result<RecoveryValidationContext, Box<dyn Error>> {
    Ok(RecoveryValidationContext {
        expected_request_id: "recovery-1".to_owned(),
        live_context: replica_context()?,
        captured_frontier: revision(captured),
    })
}

fn authority_frontier(value: u64) -> AuthorityFrontier {
    AuthorityFrontier {
        received: revision(value),
        material: revision(value),
        control: revision(value),
    }
}

fn recovery_transaction() -> Result<RecoveryTransaction, Box<dyn Error>> {
    Ok(RecoveryTransaction::new(RecoveryTransactionConfig {
        local_context: replica_context()?,
        request_timeout_ms: safe(GOLDEN_RECOVERY_REQUEST_TIMEOUT_MS),
        control_timeout_ms: safe(GOLDEN_RECOVERY_CONTROL_TIMEOUT_MS),
        pacing_ms: safe(GOLDEN_RECOVERY_PACING_MS),
        timer_owner_id: "recovery-property".to_owned(),
    })?)
}

fn assert_authority_delivery_actions(
    actions: &[AuthorityLogAction],
    expected_entry: &AuthorityEntry,
    peers: &[u64],
    expected_timer_id: u64,
    seed: u64,
    operation: &str,
) {
    assert_eq!(
        actions.len(),
        peers.len() + 1,
        "seed={seed} operation={operation} publication action count"
    );
    let Some(AuthorityLogAction::Scheduler {
        command: SchedulerCommand::Schedule { timer },
    }) = actions.first()
    else {
        panic!("seed={seed} operation={operation} schedule must precede delivery");
    };
    assert_eq!(
        timer.timer_id,
        TimerId::new(safe(expected_timer_id)),
        "seed={seed} operation={operation} publication timer id"
    );
    assert_eq!(
        timer.endpoint,
        seat(0),
        "seed={seed} operation={operation} publication timer endpoint"
    );
    assert_eq!(
        timer.owner,
        timer_owner(
            &format!("authority-v2-property:delivery:{}", expected_entry.revision),
            &format!("authority-log/delivery/{}", expected_entry.revision),
            &format!(
                "redeliver revision {} until mechanical quorum",
                expected_entry.revision
            ),
        ),
        "seed={seed} operation={operation} publication timer owner"
    );
    assert_eq!(
        timer.delay_ms,
        safe(GOLDEN_DELIVERY_INITIAL_MS),
        "seed={seed} operation={operation} publication timer delay"
    );
    assert_eq!(
        timer.time_class,
        TimeClass::Connected,
        "seed={seed} operation={operation} publication timer class"
    );
    for (index, peer) in peers.iter().enumerate() {
        match actions.get(index + 1) {
            Some(AuthorityLogAction::Deliver { to, entry }) => {
                assert_eq!(
                    *to,
                    seat(*peer),
                    "seed={seed} operation={operation} delivery peer index={index}"
                );
                assert_eq!(
                    entry.as_ref(),
                    expected_entry,
                    "seed={seed} operation={operation} delivered entry index={index}"
                );
            }
            other => {
                panic!("seed={seed} operation={operation} delivery index={index} was {other:?}")
            }
        }
    }
}

fn assert_authority_delivery_only(
    actions: &[AuthorityLogAction],
    expected_entry: &AuthorityEntry,
    peers: &[u64],
    seed: u64,
    operation: &str,
) {
    assert_eq!(
        actions.len(),
        peers.len(),
        "seed={seed} operation={operation} immediate delivery action count"
    );
    for (index, peer) in peers.iter().enumerate() {
        match actions.get(index) {
            Some(AuthorityLogAction::Deliver { to, entry }) => {
                assert_eq!(
                    *to,
                    seat(*peer),
                    "seed={seed} operation={operation} delivery peer"
                );
                assert_eq!(
                    entry.as_ref(),
                    expected_entry,
                    "seed={seed} operation={operation} redelivery entry"
                );
            }
            other => panic!(
                "seed={seed} operation={operation} immediate delivery index={index} was {other:?}"
            ),
        }
    }
}

fn assert_replica_admitted_actions(
    actions: &[ReplicaAction],
    entry: &AuthorityEntry,
    seed: u64,
    operation: &str,
) {
    match actions {
        [
            ReplicaAction::EmitReceipt { receipt },
            ReplicaAction::ApplyMaterial { entry: applied },
        ] => {
            assert_eq!(
                receipt.revision, entry.revision,
                "seed={seed} operation={operation} admitted revision"
            );
            assert_eq!(
                receipt.operation_id, entry.operation_id,
                "seed={seed} operation={operation} admitted operation"
            );
            assert_eq!(
                receipt.stage,
                AckStage::Admitted,
                "seed={seed} operation={operation} admitted stage"
            );
            assert_eq!(
                receipt.control_id, None,
                "seed={seed} operation={operation} admitted control id"
            );
            assert_eq!(
                applied, entry,
                "seed={seed} operation={operation} admitted entry"
            );
        }
        other => panic!("seed={seed} operation={operation} admitted action order was {other:?}"),
    }
}

fn assert_replica_material_actions(
    actions: &[ReplicaAction],
    entry: &AuthorityEntry,
    expected_control_id: &str,
    seed: u64,
    operation: &str,
) {
    match actions {
        [
            ReplicaAction::EmitReceipt { receipt },
            ReplicaAction::ProjectControl {
                entry: projected,
                expected_control_id: projected_id,
            },
        ] => {
            assert_eq!(
                receipt.revision, entry.revision,
                "seed={seed} operation={operation} material receipt revision"
            );
            assert_eq!(
                receipt.operation_id, entry.operation_id,
                "seed={seed} operation={operation} material receipt operation"
            );
            assert_eq!(
                receipt.stage,
                AckStage::MaterialApplied,
                "seed={seed} operation={operation} material receipt stage"
            );
            assert_eq!(
                receipt.control_id, None,
                "seed={seed} operation={operation} material receipt control id"
            );
            assert_eq!(
                projected, entry,
                "seed={seed} operation={operation} projected entry"
            );
            assert_eq!(
                projected_id.as_str(),
                expected_control_id,
                "seed={seed} operation={operation} projected control id"
            );
        }
        other => panic!("seed={seed} operation={operation} material action order was {other:?}"),
    }
}

fn assert_replica_control_actions(
    actions: &[ReplicaAction],
    entry: &AuthorityEntry,
    expected_control_id: &str,
    seed: u64,
    operation: &str,
) {
    match actions {
        [
            ReplicaAction::EmitReceipt { receipt },
            ReplicaAction::ProbePresentation { entry: probed },
        ] => {
            assert_eq!(
                receipt.revision, entry.revision,
                "seed={seed} operation={operation} control receipt revision"
            );
            assert_eq!(
                receipt.operation_id, entry.operation_id,
                "seed={seed} operation={operation} control receipt operation"
            );
            assert_eq!(
                receipt.stage,
                AckStage::ControlInstalled,
                "seed={seed} operation={operation} control receipt stage"
            );
            assert_eq!(
                receipt.control_id.as_deref(),
                Some(expected_control_id),
                "seed={seed} operation={operation} exact control id"
            );
            assert_eq!(
                probed, entry,
                "seed={seed} operation={operation} presentation probe entry"
            );
        }
        other => panic!("seed={seed} operation={operation} control action order was {other:?}"),
    }
}

fn assert_replica_recovery_stage(
    actions: &[ReplicaAction],
    entry: &AuthorityEntry,
    expected_control_id: &str,
    seed: u64,
    operation: &str,
) {
    match actions {
        [
            ReplicaAction::ProjectControl {
                entry: projected,
                expected_control_id: projected_id,
            },
        ] => {
            assert_eq!(
                projected, entry,
                "seed={seed} operation={operation} recovery entry"
            );
            assert_eq!(
                projected_id.as_str(),
                expected_control_id,
                "seed={seed} operation={operation} recovery control id"
            );
        }
        other => {
            panic!("seed={seed} operation={operation} recovery stage action order was {other:?}")
        }
    }
}

fn stage_recovered_entry(
    replica: &mut AuthorityReplica,
    entry: AuthorityEntry,
    expected_control_id: &str,
    seed: u64,
    operation: &str,
) -> Result<Revision, Box<dyn Error>> {
    let actions = replica.stage_recovered_frontier(entry.clone())?;
    assert_replica_recovery_stage(&actions, &entry, expected_control_id, seed, operation);
    let frontier = replica.frontier();
    assert_eq!(
        frontier.received, entry.revision,
        "seed={seed} operation={operation} staged received frontier comes from full entry"
    );
    assert_eq!(
        frontier.material, entry.revision,
        "seed={seed} operation={operation} staged material frontier comes from full entry"
    );
    assert_eq!(
        frontier.control,
        revision(entry.revision.get().get() - 1),
        "seed={seed} operation={operation} staged control frontier preserves incomplete control"
    );
    assert_eq!(
        replica.pending_entry(),
        Some(&entry),
        "seed={seed} operation={operation} replica retains the exact staged entry"
    );
    Ok(frontier.received)
}

// Keeping each independently asserted protocol field explicit makes replay failures actionable.
#[allow(clippy::too_many_arguments)]
fn assert_recovery_schedule(
    action: &RecoveryAction,
    expected_timer_id: u64,
    expected_delay: u64,
    expected_class: TimeClass,
    expected_address: &str,
    expected_reason: &str,
    seed: u64,
    operation: &str,
) -> ScheduledTimer {
    let timer = match action {
        RecoveryAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        } => timer,
        other => panic!("seed={seed} operation={operation} recovery schedule index was {other:?}"),
    };
    assert_eq!(
        timer.timer_id,
        TimerId::new(safe(expected_timer_id)),
        "seed={seed} operation={operation} recovery timer id"
    );
    assert_eq!(
        timer.endpoint,
        seat(1),
        "seed={seed} operation={operation} recovery timer endpoint"
    );
    assert_eq!(
        timer.owner,
        timer_owner("recovery-property", expected_address, expected_reason),
        "seed={seed} operation={operation} recovery timer owner"
    );
    assert_eq!(
        timer.delay_ms,
        safe(expected_delay),
        "seed={seed} operation={operation} recovery timer delay"
    );
    assert_eq!(
        timer.time_class, expected_class,
        "seed={seed} operation={operation} recovery timer class"
    );
    timer.to_owned()
}

fn assert_recovery_terminalized(
    actions: &[RecoveryAction],
    expected_cancel_timer_ids: &[u64],
    seed: u64,
    operation: &str,
) {
    assert_eq!(
        actions.len(),
        expected_cancel_timer_ids.len() + 2,
        "seed={seed} operation={operation} exact terminal action count"
    );
    assert!(
        matches!(
            actions.first(),
            Some(RecoveryAction::FenceChanged { view })
                if view.state == RecoveryFenceState::Terminal
        ),
        "seed={seed} operation={operation} terminal fence action first"
    );
    for (index, expected_timer_id) in expected_cancel_timer_ids.iter().enumerate() {
        assert!(
            matches!(
                actions.get(index + 1),
                Some(RecoveryAction::Scheduler {
                    command: SchedulerCommand::Cancel { endpoint, timer_id }
                }) if *endpoint == seat(1) && *timer_id == TimerId::new(safe(*expected_timer_id))
            ),
            "seed={seed} operation={operation} terminal cancellation index={index}"
        );
    }
    assert!(
        matches!(actions.last(), Some(RecoveryAction::Terminalize { .. })),
        "seed={seed} operation={operation} terminal action is final"
    );
}

fn assert_proposal_arm_actions(
    actions: &[ProposalLeaseAction],
    proposal: &ProposalMessage,
    seed: u64,
    operation: &str,
) {
    match actions {
        [
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Schedule { timer: absolute },
            },
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Schedule { timer: retry },
            },
            ProposalLeaseAction::Send { proposal: sent },
        ] => {
            assert_eq!(
                absolute.timer_id,
                TimerId::new(safe(0)),
                "seed={seed} operation={operation} absolute timer id"
            );
            assert_eq!(
                absolute.endpoint, proposal.from,
                "seed={seed} operation={operation} absolute endpoint"
            );
            assert_eq!(
                absolute.owner,
                timer_owner(
                    "authority-v2:proposal:lease/first",
                    "lease/first",
                    "v2 proposal absolute ceiling"
                ),
                "seed={seed} operation={operation} absolute owner"
            );
            assert_eq!(
                absolute.delay_ms,
                safe(GOLDEN_PROPOSAL_TEST_CEILING_MS),
                "seed={seed} operation={operation} absolute delay"
            );
            assert_eq!(
                absolute.time_class,
                TimeClass::Absolute,
                "seed={seed} operation={operation} absolute class"
            );
            assert_eq!(
                retry.timer_id,
                TimerId::new(safe(1)),
                "seed={seed} operation={operation} retry timer id"
            );
            assert_eq!(
                retry.endpoint, proposal.from,
                "seed={seed} operation={operation} retry endpoint"
            );
            assert_eq!(
                retry.owner,
                timer_owner(
                    "authority-v2:proposal:lease/first",
                    "lease/first",
                    "v2 proposal retry"
                ),
                "seed={seed} operation={operation} retry owner"
            );
            assert_eq!(
                retry.delay_ms,
                safe(GOLDEN_PROPOSAL_RETRY_INITIAL_MS),
                "seed={seed} operation={operation} retry delay"
            );
            assert_eq!(
                retry.time_class,
                TimeClass::Connected,
                "seed={seed} operation={operation} retry class"
            );
            assert_eq!(
                sent, proposal,
                "seed={seed} operation={operation} proposal send ordering"
            );
        }
        other => {
            panic!("seed={seed} operation={operation} proposal arm action order was {other:?}")
        }
    }
}

fn fire_exact_timer(
    scheduler: &mut KernelScheduler,
    expected: &ScheduledTimer,
    seed: u64,
    operation: usize,
) -> Result<ScheduledTimer, Box<dyn Error>> {
    let fired = scheduler.fired(expected.timer_id).map_err(|error| {
        missing(format!(
            "seed={seed} operation={operation}: fire timer: {error}"
        ))
    })?;
    assert_eq!(
        fired, *expected,
        "seed={seed} operation={operation} removed ScheduledTimer"
    );
    Ok(fired)
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SchedulerSnapshot {
    live_timers: Vec<ScheduledTimer>,
    pending_timer_count: SafeU53,
    disposed: bool,
}

fn scheduler_snapshot(scheduler: &KernelScheduler) -> SchedulerSnapshot {
    SchedulerSnapshot {
        live_timers: scheduler.live_timers(),
        pending_timer_count: scheduler.pending_timer_count(),
        disposed: scheduler.is_disposed(),
    }
}

fn live_recovery_state(frontier: u64) -> Result<RecoveryLiveState, Box<dyn Error>> {
    Ok(RecoveryLiveState {
        frontier: authority_frontier(frontier),
        context: replica_context()?,
    })
}

fn staged_recovery_state(frontier: u64) -> Result<RecoveryLiveState, Box<dyn Error>> {
    Ok(RecoveryLiveState {
        frontier: AuthorityFrontier {
            received: revision(frontier),
            material: revision(frontier),
            control: revision(frontier - 1),
        },
        context: replica_context()?,
    })
}

#[derive(Clone, Copy, Debug)]
struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    fn new(seed: u64) -> Self {
        Self {
            state: seed.wrapping_add(0x9E37_79B9_7F4A_7C15),
        }
    }

    fn next(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.state
    }

    fn below(&mut self, bound: u64) -> u64 {
        if bound == 0 { 0 } else { self.next() % bound }
    }
}

// M2.8 is intentionally exercised here with a dependency-free reference seam:
// er-protocol owns the scheduler command boundary and must not depend on
// er-sim. These models therefore consume the real SchedulerCommand,
// ScheduledTimer, SeatId, TimerId, and ConnectionGeneration values while
// keeping clock/network state and expected event ordering independent.

#[derive(Clone, Debug, Eq, PartialEq)]
struct PropertyClockTimer {
    timer: ScheduledTimer,
    remaining_active_ms: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct VirtualClockProperty {
    now_ms: SafeU53,
    timers: BTreeMap<(SeatId, TimerId), PropertyClockTimer>,
    pause_reasons: BTreeMap<(SeatId, TimeClass), BTreeSet<String>>,
    disposed: bool,
}

impl Default for VirtualClockProperty {
    fn default() -> Self {
        Self {
            now_ms: SafeU53::ZERO,
            timers: BTreeMap::new(),
            pause_reasons: BTreeMap::new(),
            disposed: false,
        }
    }
}

impl VirtualClockProperty {
    fn apply(&mut self, command: SchedulerCommand) -> Result<(), String> {
        if self.disposed {
            return Err("virtual clock is disposed".to_owned());
        }
        match command {
            SchedulerCommand::Schedule { timer } => {
                let key = (timer.endpoint, timer.timer_id);
                if self.timers.contains_key(&key) {
                    return Err(format!("duplicate timer ({}, {})", key.0, key.1));
                }
                safe_add(self.now_ms, timer.delay_ms)?;
                self.timers.insert(
                    key,
                    PropertyClockTimer {
                        remaining_active_ms: timer.delay_ms,
                        timer,
                    },
                );
                Ok(())
            }
            SchedulerCommand::Cancel { endpoint, timer_id } => self
                .timers
                .remove(&(endpoint, timer_id))
                .map(|_| ())
                .ok_or_else(|| format!("unknown timer ({endpoint}, {timer_id})")),
            SchedulerCommand::PauseClass {
                endpoint,
                time_class,
                reason,
            } => self.pause(endpoint, time_class, reason),
            SchedulerCommand::ResumeClass {
                endpoint,
                time_class,
                reason,
            } => self.resume(endpoint, time_class, reason),
        }
    }

    fn pause(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    ) -> Result<(), String> {
        if time_class == TimeClass::Absolute {
            return Ok(());
        }
        if reason.is_empty() {
            return Err("pause reason must not be empty".to_owned());
        }
        self.pause_reasons
            .entry((endpoint, time_class))
            .or_default()
            .insert(reason);
        Ok(())
    }

    fn resume(
        &mut self,
        endpoint: SeatId,
        time_class: TimeClass,
        reason: String,
    ) -> Result<(), String> {
        if time_class == TimeClass::Absolute {
            return Ok(());
        }
        if reason.is_empty() {
            return Err("resume reason must not be empty".to_owned());
        }
        let key = (endpoint, time_class);
        if let Some(reasons) = self.pause_reasons.get_mut(&key) {
            reasons.remove(&reason);
            if reasons.is_empty() {
                self.pause_reasons.remove(&key);
            }
        }
        Ok(())
    }

    fn advance(&mut self, delta_ms: SafeU53) -> Result<Vec<(SeatId, TimerId)>, String> {
        if self.disposed {
            return Err("virtual clock is disposed".to_owned());
        }
        let next_now = safe_add(self.now_ms, delta_ms)?;
        let mut updates = Vec::with_capacity(self.timers.len());
        for (key, timer) in &self.timers {
            let remaining = if self.is_paused(key.0, timer.timer.time_class) {
                timer.remaining_active_ms
            } else {
                safe(
                    timer
                        .remaining_active_ms
                        .get()
                        .saturating_sub(delta_ms.get()),
                )
            };
            updates.push((*key, remaining));
        }
        self.now_ms = next_now;
        for (key, remaining) in updates {
            if let Some(timer) = self.timers.get_mut(&key) {
                timer.remaining_active_ms = remaining;
            }
        }
        Ok(self.collect_due())
    }

    fn sync(&mut self) -> Result<Vec<(SeatId, TimerId)>, String> {
        if self.disposed {
            return Err("virtual clock is disposed".to_owned());
        }
        Ok(self.collect_due())
    }

    fn collect_due(&mut self) -> Vec<(SeatId, TimerId)> {
        let due = self
            .timers
            .iter()
            .filter(|(key, timer)| {
                timer.remaining_active_ms == SafeU53::ZERO
                    && !self.is_paused(key.0, timer.timer.time_class)
            })
            .map(|(key, _)| *key)
            .collect::<Vec<_>>();
        for key in &due {
            self.timers.remove(key);
        }
        due
    }

    fn is_paused(&self, endpoint: SeatId, time_class: TimeClass) -> bool {
        time_class != TimeClass::Absolute
            && self
                .pause_reasons
                .get(&(endpoint, time_class))
                .is_some_and(|reasons| !reasons.is_empty())
    }

    fn dispose(&mut self) {
        self.timers.clear();
        self.pause_reasons.clear();
        self.disposed = true;
    }
}

fn safe_add(left: SafeU53, right: SafeU53) -> Result<SafeU53, String> {
    left.get()
        .checked_add(right.get())
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or_else(|| "SafeU53 time overflow".to_owned())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PropertyPacket {
    packet_id: SafeU53,
    from: SeatId,
    to: SeatId,
    connection_generation: ConnectionGeneration,
    deliver_at_ms: SafeU53,
    payload: u64,
    corrupted: bool,
    stale: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PropertyNetworkEvent {
    Delivered { packet_id: SafeU53, payload: u64 },
    Dropped { packet_id: SafeU53 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FaultNetworkPropertySnapshot {
    seed: String,
    rng_state: u32,
    next_packet_id: u64,
    generations: BTreeMap<SeatId, ConnectionGeneration>,
    queue: Vec<PropertyPacket>,
    reordered_packet_ids: BTreeSet<SafeU53>,
    disconnected: BTreeSet<SeatId>,
    suspended: BTreeSet<SeatId>,
    dropped_count: SafeU53,
    duplicated_count: SafeU53,
    corrupted_count: SafeU53,
    disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FaultNetworkProperty {
    seed: u64,
    rng_state: u32,
    endpoints: [SeatId; 2],
    generations: BTreeMap<SeatId, ConnectionGeneration>,
    queue: Vec<PropertyPacket>,
    reordered_packet_ids: BTreeSet<SafeU53>,
    next_packet_id: u64,
    disconnected: BTreeSet<SeatId>,
    suspended: BTreeSet<SeatId>,
    dropped_count: SafeU53,
    duplicated_count: SafeU53,
    corrupted_count: SafeU53,
    disposed: bool,
}

impl FaultNetworkProperty {
    fn new(seed: u64, endpoints: [SeatId; 2]) -> Self {
        let mut generations = BTreeMap::new();
        generations.insert(endpoints[0], ConnectionGeneration::ZERO);
        generations.insert(endpoints[1], ConnectionGeneration::ZERO);
        Self {
            seed,
            rng_state: seed as u32,
            endpoints,
            generations,
            queue: Vec::new(),
            reordered_packet_ids: BTreeSet::new(),
            next_packet_id: 0,
            disconnected: BTreeSet::new(),
            suspended: BTreeSet::new(),
            dropped_count: SafeU53::ZERO,
            duplicated_count: SafeU53::ZERO,
            corrupted_count: SafeU53::ZERO,
            disposed: false,
        }
    }

    fn snapshot(&self) -> FaultNetworkPropertySnapshot {
        FaultNetworkPropertySnapshot {
            seed: self.seed.to_string(),
            rng_state: self.rng_state,
            next_packet_id: self.next_packet_id,
            generations: self.generations.clone(),
            queue: self.queue.clone(),
            reordered_packet_ids: self.reordered_packet_ids.clone(),
            disconnected: self.disconnected.clone(),
            suspended: self.suspended.clone(),
            dropped_count: self.dropped_count,
            duplicated_count: self.duplicated_count,
            corrupted_count: self.corrupted_count,
            disposed: self.disposed,
        }
    }

    fn enqueue(
        &mut self,
        from: SeatId,
        to: SeatId,
        connection_generation: ConnectionGeneration,
        payload: u64,
        now_ms: SafeU53,
    ) -> Result<SafeU53, String> {
        self.ensure_live()?;
        self.ensure_endpoint(from)?;
        self.ensure_endpoint(to)?;
        if self.disconnected.contains(&from) {
            return Err(format!("endpoint {from} is disconnected"));
        }
        if self.disconnected.contains(&to) {
            return Err(format!("endpoint {to} is disconnected"));
        }
        let mut next_rng = self.rng_state;
        let delay_ms = 1 + (u64::from(mulberry_next(&mut next_rng)) * 5) / 4_294_967_296;
        let deliver_at_ms = safe_add(now_ms, safe(delay_ms))?;
        let packet_id = SafeU53::new(self.next_packet_id)
            .map_err(|_| "packet id space is exhausted".to_owned())?;
        let next_packet_id = self
            .next_packet_id
            .checked_add(1)
            .ok_or_else(|| "packet id space is exhausted".to_owned())?;
        let source_generation = self.connection_generation(from);
        let destination_generation = self.connection_generation(to);
        self.queue.push(PropertyPacket {
            packet_id,
            from,
            to,
            connection_generation,
            deliver_at_ms,
            payload,
            corrupted: false,
            stale: connection_generation != source_generation
                || connection_generation != destination_generation,
        });
        self.rng_state = next_rng;
        self.next_packet_id = next_packet_id;
        Ok(packet_id)
    }

    fn deliver(&mut self, packet_id: SafeU53) -> Result<PropertyNetworkEvent, String> {
        let index = self.packet_index(packet_id)?;
        let packet = self.queue.remove(index);
        self.reordered_packet_ids.remove(&packet_id);
        if self.packet_is_stale(&packet) {
            self.bump_dropped();
            Ok(PropertyNetworkEvent::Dropped { packet_id })
        } else {
            Ok(PropertyNetworkEvent::Delivered {
                packet_id,
                payload: packet.payload,
            })
        }
    }

    fn drop_packet(&mut self, packet_id: SafeU53) -> Result<PropertyNetworkEvent, String> {
        let index = self.packet_index(packet_id)?;
        self.queue.remove(index);
        self.reordered_packet_ids.remove(&packet_id);
        self.bump_dropped();
        Ok(PropertyNetworkEvent::Dropped { packet_id })
    }

    fn duplicate(&mut self, packet_id: SafeU53) -> Result<SafeU53, String> {
        let index = self.packet_index(packet_id)?;
        let duplicate_id = SafeU53::new(self.next_packet_id)
            .map_err(|_| "packet id space is exhausted".to_owned())?;
        let next_packet_id = self
            .next_packet_id
            .checked_add(1)
            .ok_or_else(|| "packet id space is exhausted".to_owned())?;
        let mut duplicate = self.queue[index].clone();
        duplicate.packet_id = duplicate_id;
        self.queue.insert(index + 1, duplicate);
        self.next_packet_id = next_packet_id;
        self.duplicated_count = safe(self.duplicated_count.get().saturating_add(1));
        Ok(duplicate_id)
    }

    fn delay(&mut self, packet_id: SafeU53, additional_ms: SafeU53) -> Result<(), String> {
        let index = self.packet_index(packet_id)?;
        let deliver_at_ms = safe_add(self.queue[index].deliver_at_ms, additional_ms)?;
        self.queue[index].deliver_at_ms = deliver_at_ms;
        Ok(())
    }

    fn reorder(&mut self, packet_ids: Vec<SafeU53>) -> Result<(), String> {
        let mut seen = BTreeSet::new();
        for packet_id in &packet_ids {
            if !seen.insert(*packet_id) {
                return Err(format!("packet {packet_id} appears more than once"));
            }
            self.packet_index(*packet_id)?;
        }
        if packet_ids.is_empty() {
            return Ok(());
        }
        let mut reordered = Vec::with_capacity(self.queue.len());
        for packet_id in &packet_ids {
            let index = self.packet_index(*packet_id)?;
            reordered.push(self.queue.remove(index));
        }
        reordered.append(&mut self.queue);
        self.queue = reordered;
        self.reordered_packet_ids = seen;
        Ok(())
    }

    fn corrupt(&mut self, packet_id: SafeU53) -> Result<(), String> {
        let index = self.packet_index(packet_id)?;
        self.queue[index].corrupted = true;
        self.corrupted_count = safe(self.corrupted_count.get().saturating_add(1));
        Ok(())
    }

    fn deliver_due(&mut self, now_ms: SafeU53) -> Result<Vec<PropertyNetworkEvent>, String> {
        self.ensure_live()?;
        let mut events = self.reap_stale();
        while let Some(index) = self.next_reordered_due_index(now_ms) {
            let packet_id = self.queue[index].packet_id;
            events.push(self.deliver(packet_id)?);
        }
        while let Some(index) = self.next_due_index(now_ms) {
            let packet_id = self.queue[index].packet_id;
            events.push(self.deliver(packet_id)?);
        }
        Ok(events)
    }

    fn disconnect(&mut self, endpoint: SeatId) -> bool {
        if self.disposed || !self.is_endpoint(endpoint) || !self.disconnected.insert(endpoint) {
            return false;
        }
        for packet in &mut self.queue {
            if packet.from == endpoint || packet.to == endpoint {
                packet.stale = true;
            }
        }
        true
    }

    fn reconnect(&mut self, endpoint: SeatId) -> Result<ConnectionGeneration, String> {
        self.ensure_live()?;
        self.ensure_endpoint(endpoint)?;
        let current = self.connection_generation(endpoint).get().get();
        let next = current
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or_else(|| "connection generation is exhausted".to_owned())?;
        for packet in &mut self.queue {
            if packet.from == endpoint || packet.to == endpoint {
                packet.stale = true;
            }
        }
        let next_generation = ConnectionGeneration::new(next);
        self.generations.insert(self.endpoints[0], next_generation);
        self.generations.insert(self.endpoints[1], next_generation);
        self.disconnected.remove(&endpoint);
        Ok(next_generation)
    }

    fn suspend(&mut self, endpoint: SeatId) -> bool {
        if self.disposed || !self.is_endpoint(endpoint) {
            return false;
        }
        self.suspended.insert(endpoint)
    }

    fn resume(&mut self, endpoint: SeatId) -> bool {
        if self.disposed || !self.is_endpoint(endpoint) {
            return false;
        }
        self.suspended.remove(&endpoint)
    }

    fn connection_generation(&self, endpoint: SeatId) -> ConnectionGeneration {
        self.generations
            .get(&endpoint)
            .copied()
            .unwrap_or(ConnectionGeneration::ZERO)
    }

    fn dispose(&mut self) {
        self.queue.clear();
        self.reordered_packet_ids.clear();
        self.disconnected.clear();
        self.suspended.clear();
        self.disposed = true;
    }

    fn ensure_live(&self) -> Result<(), String> {
        if self.disposed {
            Err("fault network is disposed".to_owned())
        } else {
            Ok(())
        }
    }

    fn ensure_endpoint(&self, endpoint: SeatId) -> Result<(), String> {
        if self.is_endpoint(endpoint) {
            Ok(())
        } else {
            Err(format!("endpoint {endpoint} is not configured"))
        }
    }

    fn is_endpoint(&self, endpoint: SeatId) -> bool {
        self.endpoints.contains(&endpoint)
    }

    fn packet_index(&self, packet_id: SafeU53) -> Result<usize, String> {
        self.queue
            .iter()
            .position(|packet| packet.packet_id == packet_id)
            .ok_or_else(|| format!("packet {packet_id} is not queued"))
    }

    fn packet_is_stale(&self, packet: &PropertyPacket) -> bool {
        packet.stale
            || self.disconnected.contains(&packet.from)
            || self.disconnected.contains(&packet.to)
            || packet.connection_generation != self.connection_generation(packet.from)
            || packet.connection_generation != self.connection_generation(packet.to)
    }

    fn reap_stale(&mut self) -> Vec<PropertyNetworkEvent> {
        let mut events = Vec::new();
        let mut index = 0;
        while index < self.queue.len() {
            if self.packet_is_stale(&self.queue[index]) {
                let packet_id = self.queue.remove(index).packet_id;
                self.reordered_packet_ids.remove(&packet_id);
                self.bump_dropped();
                events.push(PropertyNetworkEvent::Dropped { packet_id });
            } else {
                index += 1;
            }
        }
        events
    }

    fn next_reordered_due_index(&self, now_ms: SafeU53) -> Option<usize> {
        self.queue.iter().enumerate().find_map(|(index, packet)| {
            (self.reordered_packet_ids.contains(&packet.packet_id)
                && packet.deliver_at_ms <= now_ms)
                .then_some(index)
        })
    }

    fn next_due_index(&self, now_ms: SafeU53) -> Option<usize> {
        self.queue
            .iter()
            .enumerate()
            .filter(|(_, packet)| packet.deliver_at_ms <= now_ms)
            .min_by_key(|(index, packet)| (packet.deliver_at_ms, *index, packet.packet_id))
            .map(|(index, _)| index)
    }

    fn bump_dropped(&mut self) {
        self.dropped_count = safe(self.dropped_count.get().saturating_add(1));
    }
}

fn mulberry_next(state: &mut u32) -> u32 {
    let a = state.wrapping_add(0x6D2B_79F5);
    *state = a;
    let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t));
    t ^ (t >> 14)
}

fn generated_json(rng: &mut DeterministicRng, depth: u8) -> Value {
    if depth >= 2 {
        return match rng.below(5) {
            0 => Value::Null,
            1 => Value::Bool(rng.below(2) == 0),
            2 => Value::from(rng.below(17) as i64 - 8),
            3 => Value::String(format!("s{}", rng.below(9))),
            _ => Value::Array(Vec::new()),
        };
    }
    match rng.below(7) {
        0 => Value::Null,
        1 => Value::Bool(rng.below(2) == 0),
        2 => Value::from(rng.below(33) as i64 - 16),
        3 => Value::String(format!("value-{}", rng.below(17))),
        4 => Value::Array(
            (0..rng.below(3))
                .map(|_| generated_json(rng, depth + 1))
                .collect(),
        ),
        5 => {
            let mut object = Map::new();
            for index in 0..rng.below(3) {
                object.insert(format!("k{index}"), generated_json(rng, depth + 1));
            }
            Value::Object(object)
        }
        _ => json!({"v": 2, "t": "futureCosmetic", "body": generated_json(rng, depth + 1)}),
    }
}

fn class_for(value: u64) -> TimeClass {
    match value % 5 {
        0 => TimeClass::Connected,
        1 => TimeClass::Recovery,
        2 => TimeClass::Renderer,
        3 => TimeClass::HumanInput,
        _ => TimeClass::Absolute,
    }
}

fn paused_reason_exists(
    reasons: &BTreeSet<(SeatId, TimeClass, String)>,
    endpoint: SeatId,
    time_class: TimeClass,
    reason: &str,
) -> bool {
    reasons.contains(&(endpoint, time_class, reason.to_owned()))
}

fn assert_scheduler_pause_invariants(
    scheduler: &KernelScheduler,
    reasons: &BTreeSet<(SeatId, TimeClass, String)>,
    seed: u64,
    step: usize,
) {
    for endpoint in [seat(0), seat(1), seat(2)] {
        for time_class in [
            TimeClass::Connected,
            TimeClass::Recovery,
            TimeClass::Renderer,
            TimeClass::HumanInput,
            TimeClass::Absolute,
        ] {
            let expected = time_class != TimeClass::Absolute
                && reasons.iter().any(|(owned_endpoint, owned_class, _)| {
                    *owned_endpoint == endpoint && *owned_class == time_class
                });
            assert_eq!(
                scheduler.is_class_paused(endpoint, time_class),
                expected,
                "seed={seed} operation={step} pause invariant endpoint={endpoint} class={time_class:?}"
            );
        }
    }
}

#[test]
fn scheduler_seeded_state_machine_preserves_timer_ownership_and_pause_composition() -> TestResult {
    for seed in 0..12_u64 {
        let mut rng = DeterministicRng::new(seed);
        let mut scheduler = KernelScheduler::new();
        let mut live = BTreeMap::<TimerId, ScheduledTimer>::new();
        let mut issued_ids = BTreeSet::<TimerId>::new();
        let mut pause_reasons = BTreeSet::<(SeatId, TimeClass, String)>::new();

        for step in 0..64_usize {
            match rng.below(6) {
                0 => {
                    let endpoint = seat(rng.below(3));
                    let owner_id = if rng.below(2) == 0 {
                        "owner-a"
                    } else {
                        "owner-b"
                    };
                    let time_class = class_for(rng.next());
                    let owner = timer_owner(
                        owner_id,
                        &format!("property/{seed}/{step}"),
                        "seeded property timer",
                    );
                    let delay_ms = safe(1 + rng.below(500));
                    let result = scheduler.schedule(endpoint, owner.clone(), delay_ms, time_class);
                    let command = match result {
                        Ok(command) => command,
                        Err(error) => {
                            return Err(missing(format!(
                                "seed={seed} operation={step}: schedule failed: {error}"
                            )));
                        }
                    };
                    let timer = match command {
                        SchedulerCommand::Schedule { timer } => timer,
                        other => {
                            return Err(missing(format!(
                                "seed={seed} operation={step}: unexpected schedule command: {other:?}"
                            )));
                        }
                    };
                    assert_eq!(
                        timer.endpoint, endpoint,
                        "seed={seed} operation={step} endpoint"
                    );
                    assert_eq!(timer.owner, owner, "seed={seed} operation={step} owner");
                    assert_eq!(
                        timer.delay_ms, delay_ms,
                        "seed={seed} operation={step} delay"
                    );
                    assert_eq!(
                        timer.time_class, time_class,
                        "seed={seed} operation={step} class"
                    );
                    assert!(
                        live.insert(timer.timer_id, timer.clone()).is_none(),
                        "seed={seed} operation={step} duplicate timer id"
                    );
                    assert!(
                        issued_ids.insert(timer.timer_id),
                        "seed={seed} operation={step} timer id was reused"
                    );
                }
                1 => {
                    let timer_id = if let Some(timer_id) = live.keys().next().copied() {
                        timer_id
                    } else {
                        TimerId::new(safe(900_000 + seed * 100 + step as u64))
                    };
                    let expected = live
                        .remove(&timer_id)
                        .map(|timer| SchedulerCommand::Cancel {
                            endpoint: timer.endpoint,
                            timer_id,
                        });
                    assert_eq!(
                        scheduler.cancel(timer_id),
                        expected,
                        "seed={seed} operation={step} cancel"
                    );
                }
                2 => {
                    let owner_id = if rng.below(2) == 0 {
                        "owner-a"
                    } else {
                        "owner-b"
                    };
                    let expected_ids = live
                        .iter()
                        .filter_map(|(timer_id, timer)| {
                            (timer.owner.owner_id == owner_id).then_some(*timer_id)
                        })
                        .collect::<Vec<_>>();
                    let expected = expected_ids
                        .iter()
                        .filter_map(|timer_id| live.get(timer_id))
                        .map(|timer| SchedulerCommand::Cancel {
                            endpoint: timer.endpoint,
                            timer_id: timer.timer_id,
                        })
                        .collect::<Vec<_>>();
                    assert_eq!(
                        scheduler.cancel_owner(owner_id),
                        expected,
                        "seed={seed} operation={step} owner cancel"
                    );
                    for timer_id in expected_ids {
                        live.remove(&timer_id);
                    }
                }
                3 => {
                    let timer_id = if let Some(timer_id) = live.keys().next().copied() {
                        timer_id
                    } else {
                        TimerId::new(safe(800_000 + seed * 100 + step as u64))
                    };
                    let expected = live.remove(&timer_id);
                    let fired = scheduler.fired(timer_id);
                    if let Some(expected_timer) = expected {
                        assert_eq!(
                            fired,
                            Ok(expected_timer),
                            "seed={seed} operation={step} fired"
                        );
                    } else {
                        assert_eq!(
                            fired,
                            Err(SchedulerError::UnknownTimer { timer_id }),
                            "seed={seed} operation={step} unknown fired"
                        );
                    }
                }
                4 => {
                    let endpoint = seat(rng.below(3));
                    let time_class = class_for(rng.next());
                    let reason = format!("reason-{}", rng.below(3));
                    let already_paused =
                        paused_reason_exists(&pause_reasons, endpoint, time_class, &reason);
                    let result = scheduler.pause_class(endpoint, time_class, &reason);
                    if time_class == TimeClass::Absolute {
                        assert_eq!(
                            result,
                            Ok(None),
                            "seed={seed} operation={step} absolute pause"
                        );
                    } else {
                        let expected = (!already_paused).then(|| SchedulerCommand::PauseClass {
                            endpoint,
                            time_class,
                            reason: reason.clone(),
                        });
                        assert_eq!(result, Ok(expected), "seed={seed} operation={step} pause");
                        pause_reasons.insert((endpoint, time_class, reason));
                    }
                }
                _ => {
                    let endpoint = seat(rng.below(3));
                    let time_class = class_for(rng.next());
                    let reason = format!("reason-{}", rng.below(3));
                    let existed =
                        paused_reason_exists(&pause_reasons, endpoint, time_class, &reason);
                    let result = scheduler.resume_class(endpoint, time_class, &reason);
                    if time_class == TimeClass::Absolute {
                        assert_eq!(
                            result,
                            Ok(None),
                            "seed={seed} operation={step} absolute resume"
                        );
                    } else {
                        let expected = existed.then(|| SchedulerCommand::ResumeClass {
                            endpoint,
                            time_class,
                            reason: reason.clone(),
                        });
                        assert_eq!(result, Ok(expected), "seed={seed} operation={step} resume");
                        pause_reasons.remove(&(endpoint, time_class, reason));
                    }
                }
            }

            assert_eq!(
                scheduler.live_timers(),
                live.values().cloned().collect::<Vec<_>>(),
                "seed={seed} operation={step} timer inventory"
            );
            assert_eq!(
                scheduler.pending_timer_count(),
                safe(live.len() as u64),
                "seed={seed} operation={step} timer count"
            );
            assert_scheduler_pause_invariants(&scheduler, &pause_reasons, seed, step);
        }

        let expected_dispose = live
            .values()
            .map(|timer| SchedulerCommand::Cancel {
                endpoint: timer.endpoint,
                timer_id: timer.timer_id,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            scheduler.dispose(),
            expected_dispose,
            "seed={seed} operation=disposal disposal commands"
        );
        assert!(
            scheduler.is_disposed(),
            "seed={seed} operation=disposal disposed flag"
        );
        assert!(
            scheduler.live_timers().is_empty(),
            "seed={seed} operation=disposal live timers after disposal"
        );
        assert_eq!(
            scheduler.dispose(),
            Vec::new(),
            "seed={seed} operation=disposal idempotent disposal"
        );
        assert_eq!(
            scheduler.cancel_owner("owner-a"),
            Vec::new(),
            "seed={seed} operation=post-dispose owner cancel"
        );
        assert_eq!(
            scheduler.pending_timer_count(),
            SafeU53::ZERO,
            "seed={seed} operation=post-dispose count"
        );
        assert_eq!(
            scheduler.schedule(
                seat(0),
                timer_owner("later", "later", "later"),
                safe(1),
                TimeClass::Connected
            ),
            Err(SchedulerError::Disposed),
            "seed={seed} operation=post-dispose schedule after disposal",
        );
    }

    let mut gates = KernelScheduler::new();
    assert_eq!(
        gates.set_connected(seat(7), false)?,
        vec![SchedulerCommand::PauseClass {
            endpoint: seat(7),
            time_class: TimeClass::Connected,
            reason: "disconnected".to_owned(),
        }]
    );
    assert!(gates.is_class_paused(seat(7), TimeClass::Connected));
    assert_eq!(
        gates.set_suspended(seat(7), true)?,
        vec![
            SchedulerCommand::PauseClass {
                endpoint: seat(7),
                time_class: TimeClass::Connected,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::PauseClass {
                endpoint: seat(7),
                time_class: TimeClass::Recovery,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::PauseClass {
                endpoint: seat(7),
                time_class: TimeClass::Renderer,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::PauseClass {
                endpoint: seat(7),
                time_class: TimeClass::HumanInput,
                reason: "suspended".to_owned(),
            },
        ],
        "seed=0 operation=boundary suspension pause order"
    );
    assert!(!gates.is_class_paused(seat(7), TimeClass::Absolute));
    assert_eq!(
        gates.set_suspended(seat(7), false)?,
        vec![
            SchedulerCommand::ResumeClass {
                endpoint: seat(7),
                time_class: TimeClass::Connected,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::ResumeClass {
                endpoint: seat(7),
                time_class: TimeClass::Recovery,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::ResumeClass {
                endpoint: seat(7),
                time_class: TimeClass::Renderer,
                reason: "suspended".to_owned(),
            },
            SchedulerCommand::ResumeClass {
                endpoint: seat(7),
                time_class: TimeClass::HumanInput,
                reason: "suspended".to_owned(),
            },
        ],
        "seed=0 operation=boundary suspension resume order"
    );
    assert!(gates.is_class_paused(seat(7), TimeClass::Connected));
    assert_eq!(gates.set_connected(seat(7), true)?.len(), 1);
    assert!(!gates.is_class_paused(seat(7), TimeClass::Connected));
    assert_eq!(
        TimerId::new(SafeU53::MAX).get(),
        SafeU53::MAX,
        "seed=0 operation=boundary maximum TimerId preserves SafeU53 maximum"
    );

    let mut batch = KernelScheduler::new();
    let batch_commands = batch.schedule_batch(vec![
        TimerSpec {
            endpoint: seat(4),
            owner: timer_owner("batch", "batch/absolute", "batch absolute"),
            delay_ms: safe(7),
            time_class: TimeClass::Absolute,
        },
        TimerSpec {
            endpoint: seat(5),
            owner: timer_owner("batch", "batch/connected", "batch connected"),
            delay_ms: safe(9),
            time_class: TimeClass::Connected,
        },
    ])?;
    assert_eq!(
        batch_commands,
        vec![
            SchedulerCommand::Schedule {
                timer: ScheduledTimer {
                    endpoint: seat(4),
                    timer_id: TimerId::new(safe(0)),
                    owner: timer_owner("batch", "batch/absolute", "batch absolute"),
                    delay_ms: safe(7),
                    time_class: TimeClass::Absolute,
                },
            },
            SchedulerCommand::Schedule {
                timer: ScheduledTimer {
                    endpoint: seat(5),
                    timer_id: TimerId::new(safe(1)),
                    owner: timer_owner("batch", "batch/connected", "batch connected"),
                    delay_ms: safe(9),
                    time_class: TimeClass::Connected,
                },
            },
        ],
        "seed=0 operation=batch exact registration order and metadata"
    );
    assert_eq!(
        batch.pending_timer_count(),
        safe(2),
        "seed=0 operation=batch registration count"
    );
    assert_eq!(
        batch.dispose().len(),
        2,
        "seed=0 operation=batch cleanup count"
    );
    assert!(
        batch.live_timers().is_empty(),
        "seed=0 operation=batch cleanup resources"
    );

    // CR-0006/CR-0009: numeric timer IDs are lifetime-unique only inside one
    // scheduler; the simulator identity is the endpoint-qualified pair.
    let mut scheduler_a = KernelScheduler::new();
    let mut scheduler_b = KernelScheduler::new();
    let two_a = scheduler_a.schedule_batch(vec![
        TimerSpec {
            endpoint: seat(10),
            owner: timer_owner("kernel-a", "clock/a/absolute", "a absolute"),
            delay_ms: safe(3),
            time_class: TimeClass::Absolute,
        },
        TimerSpec {
            endpoint: seat(11),
            owner: timer_owner("kernel-a", "clock/a/connected", "a connected"),
            delay_ms: safe(5),
            time_class: TimeClass::Connected,
        },
    ])?;
    let two_b = scheduler_b.schedule_batch(vec![
        TimerSpec {
            endpoint: seat(20),
            owner: timer_owner("kernel-b", "clock/b/absolute", "b absolute"),
            delay_ms: safe(3),
            time_class: TimeClass::Absolute,
        },
        TimerSpec {
            endpoint: seat(21),
            owner: timer_owner("kernel-b", "clock/b/connected", "b connected"),
            delay_ms: safe(5),
            time_class: TimeClass::Connected,
        },
    ])?;
    let ids_a = two_a
        .iter()
        .filter_map(|command| match command {
            SchedulerCommand::Schedule { timer } => Some(timer.timer_id),
            _ => None,
        })
        .collect::<Vec<_>>();
    let ids_b = two_b
        .iter()
        .filter_map(|command| match command {
            SchedulerCommand::Schedule { timer } => Some(timer.timer_id),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        ids_a,
        vec![TimerId::new(safe(0)), TimerId::new(safe(1))],
        "seed=0 operation=two-scheduler A two-timer allocation boundary"
    );
    assert_eq!(
        ids_b, ids_a,
        "seed=0 operation=two-scheduler independent numeric cursor"
    );
    let a_identity = (seat(10), ids_a[0]);
    let b_identity = (seat(20), ids_b[0]);
    assert_ne!(
        a_identity, b_identity,
        "seed=0 operation=two-scheduler endpoint-qualified timer identity"
    );
    let before_two_scheduler_a = scheduler_snapshot(&scheduler_a);
    let before_two_scheduler_b = scheduler_snapshot(&scheduler_b);
    assert_eq!(
        before_two_scheduler_a.live_timers.len(),
        2,
        "seed=0 operation=two-scheduler A live resources"
    );
    assert_eq!(
        before_two_scheduler_b.live_timers.len(),
        2,
        "seed=0 operation=two-scheduler B live resources"
    );
    let _ = scheduler_a.fired(ids_a[0])?;
    assert!(
        scheduler_b.timer(ids_b[0]).is_some(),
        "seed=0 operation=two-scheduler A fire cannot consume B timer"
    );
    assert_eq!(
        scheduler_snapshot(&scheduler_a).live_timers.len(),
        1,
        "seed=0 operation=two-scheduler A fire resource count"
    );
    assert_eq!(
        scheduler_snapshot(&scheduler_b),
        before_two_scheduler_b,
        "seed=0 operation=two-scheduler B resource snapshot after A fire"
    );
    assert_eq!(
        scheduler_a.schedule(
            seat(12),
            timer_owner("kernel-a", "clock/a/third", "a third"),
            safe(7),
            TimeClass::Connected,
        )?,
        SchedulerCommand::Schedule {
            timer: ScheduledTimer {
                endpoint: seat(12),
                timer_id: TimerId::new(safe(2)),
                owner: timer_owner("kernel-a", "clock/a/third", "a third"),
                delay_ms: safe(7),
                time_class: TimeClass::Connected,
            },
        },
        "seed=0 operation=two-scheduler A cursor after two-timer batch"
    );
    assert_eq!(
        scheduler_b.schedule(
            seat(22),
            timer_owner("kernel-b", "clock/b/third", "b third"),
            safe(7),
            TimeClass::Connected,
        )?,
        SchedulerCommand::Schedule {
            timer: ScheduledTimer {
                endpoint: seat(22),
                timer_id: TimerId::new(safe(2)),
                owner: timer_owner("kernel-b", "clock/b/third", "b third"),
                delay_ms: safe(7),
                time_class: TimeClass::Connected,
            },
        },
        "seed=0 operation=two-scheduler B cursor after two-timer batch"
    );
    let _ = scheduler_a.dispose();
    let _ = scheduler_b.dispose();
    assert!(
        scheduler_a.live_timers().is_empty(),
        "seed=0 operation=two-scheduler A disposal resources"
    );
    assert!(
        scheduler_b.live_timers().is_empty(),
        "seed=0 operation=two-scheduler B disposal resources"
    );

    let mut disposed_batch = KernelScheduler::new();
    let _ = disposed_batch.dispose();
    assert_eq!(
        disposed_batch.schedule_batch(vec![TimerSpec {
            endpoint: seat(0),
            owner: timer_owner("batch", "batch/disposed", "batch disposed"),
            delay_ms: safe(1),
            time_class: TimeClass::Connected,
        }]),
        Err(SchedulerError::Disposed),
        "seed=0 operation=batch disposed batch is atomic"
    );
    Ok(())
}

#[test]
fn m2_8_seeded_virtual_clock_and_fault_network_state_machine_is_endpoint_qualified() -> TestResult {
    for seed in 0..8_u64 {
        let endpoints = [seat(40), seat(41)];
        let mut clock = VirtualClockProperty::default();
        let mut scheduler_a = KernelScheduler::new();
        let mut scheduler_b = KernelScheduler::new();
        let first_a = replay(
            seed,
            "clock-scheduler-a",
            scheduler_a.schedule(
                endpoints[0],
                timer_owner("clock-a", "clock/a/connected", "clock a"),
                safe(3),
                TimeClass::Connected,
            ),
        )?;
        let first_b = replay(
            seed,
            "clock-scheduler-b",
            scheduler_b.schedule(
                endpoints[1],
                timer_owner("clock-b", "clock/b/connected", "clock b"),
                safe(3),
                TimeClass::Connected,
            ),
        )?;
        let first_a_timer = match &first_a {
            SchedulerCommand::Schedule { timer } => timer.clone(),
            other => {
                return Err(missing(format!(
                    "seed={seed} operation=clock-scheduler-a command was {other:?}"
                )));
            }
        };
        let first_b_timer = match &first_b {
            SchedulerCommand::Schedule { timer } => timer.clone(),
            other => {
                return Err(missing(format!(
                    "seed={seed} operation=clock-scheduler-b command was {other:?}"
                )));
            }
        };
        assert_eq!(
            first_a_timer.timer_id, first_b_timer.timer_id,
            "seed={seed} operation=clock same numeric IDs are independent"
        );
        replay(seed, "clock-apply-a", clock.apply(first_a))?;
        replay(seed, "clock-apply-b", clock.apply(first_b))?;
        let pause_b = scheduler_b
            .pause_class(endpoints[1], TimeClass::Connected, "network-suspended")?
            .ok_or_else(|| missing(format!("seed={seed} operation=clock pause command missing")))?;
        replay(seed, "clock-pause-b", clock.apply(pause_b))?;
        let due_a = replay(seed, "clock-advance-a", clock.advance(safe(3)))?;
        assert_eq!(
            due_a,
            vec![(endpoints[0], first_a_timer.timer_id)],
            "seed={seed} operation=clock endpoint A fires while B is paused"
        );
        let fired_a = replay(
            seed,
            "clock-fire-a",
            scheduler_a.fired(first_a_timer.timer_id),
        )?;
        assert_eq!(
            fired_a, first_a_timer,
            "seed={seed} operation=clock A fire identity"
        );
        let resume_b = scheduler_b
            .resume_class(endpoints[1], TimeClass::Connected, "network-suspended")?
            .ok_or_else(|| {
                missing(format!(
                    "seed={seed} operation=clock resume command missing"
                ))
            })?;
        replay(seed, "clock-resume-b", clock.apply(resume_b))?;
        let due_b = replay(seed, "clock-advance-b", clock.advance(safe(3)))?;
        assert_eq!(
            due_b,
            vec![(endpoints[1], first_b_timer.timer_id)],
            "seed={seed} operation=clock endpoint B resumes and fires independently"
        );
        let fired_b = replay(
            seed,
            "clock-fire-b",
            scheduler_b.fired(first_b_timer.timer_id),
        )?;
        assert_eq!(
            fired_b, first_b_timer,
            "seed={seed} operation=clock B fire identity"
        );
        assert!(
            replay(seed, "clock-sync-empty", clock.sync())?.is_empty(),
            "seed={seed} operation=clock sync after both timer fires is empty"
        );

        let mut network = FaultNetworkProperty::new(seed, endpoints);
        let initial_generation_a = network.connection_generation(endpoints[0]);
        let first_packet = replay(
            seed,
            "network-enqueue-initial",
            network.enqueue(
                endpoints[0],
                endpoints[1],
                initial_generation_a,
                100,
                SafeU53::ZERO,
            ),
        )?;
        let initial_generation_b = network.connection_generation(endpoints[1]);
        let second_packet = replay(
            seed,
            "network-enqueue-reverse",
            network.enqueue(
                endpoints[1],
                endpoints[0],
                initial_generation_b,
                200,
                SafeU53::ZERO,
            ),
        )?;
        assert_eq!(
            first_packet,
            SafeU53::ZERO,
            "seed={seed} operation=network first packet ID"
        );
        assert_eq!(
            second_packet,
            safe(1),
            "seed={seed} operation=network second packet ID"
        );
        replay(
            seed,
            "network-delay-initial",
            network.delay(first_packet, safe(2)),
        )?;
        let duplicate_packet = replay(
            seed,
            "network-duplicate-initial",
            network.duplicate(first_packet),
        )?;
        assert_eq!(
            duplicate_packet,
            safe(2),
            "seed={seed} operation=network duplicate packet ID"
        );
        replay(
            seed,
            "network-reorder-initial",
            network.reorder(vec![second_packet, first_packet, duplicate_packet]),
        )?;
        replay(
            seed,
            "network-corrupt-initial",
            network.corrupt(second_packet),
        )?;
        assert!(matches!(
            replay(seed, "network-deliver-initial", network.deliver(second_packet))?,
            PropertyNetworkEvent::Delivered { packet_id, payload }
                if packet_id == second_packet && payload == 200
        ));
        assert!(matches!(
            replay(seed, "network-drop-duplicate", network.drop_packet(duplicate_packet))?,
            PropertyNetworkEvent::Dropped { packet_id } if packet_id == duplicate_packet
        ));
        assert!(
            network.suspend(endpoints[0]),
            "seed={seed} operation=network-suspend-initial"
        );
        assert!(network.snapshot().suspended.contains(&endpoints[0]));
        assert!(
            network.resume(endpoints[0]),
            "seed={seed} operation=network-resume-initial"
        );
        let stale_generation = network.connection_generation(endpoints[0]);
        let stale_packet = replay(
            seed,
            "network-generation-packet",
            network.enqueue(
                endpoints[0],
                endpoints[1],
                stale_generation,
                300,
                SafeU53::ZERO,
            ),
        )?;
        assert!(
            network.disconnect(endpoints[0]),
            "seed={seed} operation=network-disconnect-initial"
        );
        let next_generation = replay(
            seed,
            "network-reconnect-initial",
            network.reconnect(endpoints[0]),
        )?;
        assert_eq!(
            next_generation,
            generation(1),
            "seed={seed} operation=network-reconnect-initial generation"
        );
        let stale_events = replay(seed, "network-deliver-stale", network.deliver_due(safe(10)))?;
        assert!(stale_events.iter().any(|event| matches!(event, PropertyNetworkEvent::Dropped { packet_id } if *packet_id == stale_packet)), "seed={seed} operation=network-generation-stale packet drops");
        assert!(
            !network.snapshot().disconnected.contains(&endpoints[0]),
            "seed={seed} operation=network-reconnect-initial disconnected state"
        );
        let mut rng = DeterministicRng::new(seed ^ 0xC0FF_EE11);
        let mut now_ms = SafeU53::ZERO;
        for step in 0..96_usize {
            let operation = rng.below(12);
            let before = network.snapshot();
            let queued = before
                .queue
                .iter()
                .map(|packet| packet.packet_id)
                .collect::<Vec<_>>();
            match operation {
                0 => {
                    if before.disconnected.is_empty() {
                        let from = if step % 2 == 0 {
                            endpoints[0]
                        } else {
                            endpoints[1]
                        };
                        let to = if from == endpoints[0] {
                            endpoints[1]
                        } else {
                            endpoints[0]
                        };
                        let current_generation = network.connection_generation(from);
                        let _ = replay(
                            seed,
                            format!("network-enqueue-{step}"),
                            network.enqueue(
                                from,
                                to,
                                current_generation,
                                100 + step as u64,
                                now_ms,
                            ),
                        )?;
                    } else {
                        let current_generation = network.connection_generation(endpoints[0]);
                        assert!(
                            network
                                .enqueue(
                                    endpoints[0],
                                    endpoints[1],
                                    current_generation,
                                    step as u64,
                                    now_ms,
                                )
                                .is_err(),
                            "seed={seed} operation=network-enqueue-{step} disconnected send rejects"
                        );
                        assert_eq!(
                            network.snapshot(),
                            before,
                            "seed={seed} operation=network-enqueue-{step} disconnected send is fail-atomic"
                        );
                    }
                }
                1 if !queued.is_empty() => {
                    replay(
                        seed,
                        format!("network-delay-{step}"),
                        network.delay(queued[0], safe(2)),
                    )?;
                }
                2 if !queued.is_empty() => {
                    let _ = replay(
                        seed,
                        format!("network-duplicate-{step}"),
                        network.duplicate(queued[0]),
                    )?;
                }
                3 if queued.len() >= 2 => {
                    replay(
                        seed,
                        format!("network-reorder-{step}"),
                        network.reorder(vec![queued[1], queued[0]]),
                    )?;
                }
                4 => {
                    now_ms = safe(now_ms.get().saturating_add(1));
                    let events = replay(
                        seed,
                        format!("network-deliver-due-{step}"),
                        network.deliver_due(now_ms),
                    )?;
                    for event in events {
                        match event {
                            PropertyNetworkEvent::Delivered { packet_id, payload } => {
                                assert!(
                                    payload >= 100,
                                    "seed={seed} operation=network-deliver-{step} delivered payload identity"
                                );
                                assert!(
                                    !network
                                        .snapshot()
                                        .queue
                                        .iter()
                                        .any(|packet| packet.packet_id == packet_id),
                                    "seed={seed} operation=network-deliver-{step} delivered packet removed"
                                );
                            }
                            PropertyNetworkEvent::Dropped { packet_id } => assert!(
                                !network
                                    .snapshot()
                                    .queue
                                    .iter()
                                    .any(|packet| packet.packet_id == packet_id),
                                "seed={seed} operation=network-drop-{step} dropped packet removed"
                            ),
                        }
                    }
                }
                5 if !queued.is_empty() => {
                    replay(
                        seed,
                        format!("network-drop-{step}"),
                        network.drop_packet(queued[0]),
                    )?;
                }
                6 => {
                    let changed = network.disconnect(endpoints[step % 2]);
                    assert!(
                        changed
                            || network
                                .snapshot()
                                .disconnected
                                .contains(&endpoints[step % 2]),
                        "seed={seed} operation=network-disconnect-{step} idempotent endpoint state"
                    );
                }
                7 => {
                    let endpoint = endpoints[step % 2];
                    if network.snapshot().disconnected.contains(&endpoint) {
                        replay(
                            seed,
                            format!("network-reconnect-{step}"),
                            network.reconnect(endpoint),
                        )?;
                    } else {
                        let before_reconnect = network.snapshot();
                        assert!(
                            network.reconnect(endpoint).is_ok(),
                            "seed={seed} operation=network-reconnect-{step} live generation advances"
                        );
                        assert_ne!(
                            network.snapshot().generations,
                            before_reconnect.generations,
                            "seed={seed} operation=network-reconnect-{step} generation changes"
                        );
                    }
                }
                8 => {
                    let endpoint = endpoints[step % 2];
                    let _ = network.suspend(endpoint);
                    assert!(
                        network.snapshot().suspended.contains(&endpoint),
                        "seed={seed} operation=network-suspend-{step} suspended diagnostic"
                    );
                }
                9 => {
                    let endpoint = endpoints[step % 2];
                    let _ = network.resume(endpoint);
                    assert!(
                        !network.snapshot().suspended.contains(&endpoint),
                        "seed={seed} operation=network-resume-{step} resumed diagnostic"
                    );
                }
                10 if !queued.is_empty() => {
                    replay(
                        seed,
                        format!("network-corrupt-{step}"),
                        network.corrupt(queued[0]),
                    )?;
                    assert!(
                        network
                            .snapshot()
                            .queue
                            .iter()
                            .any(|packet| packet.packet_id == queued[0] && packet.corrupted),
                        "seed={seed} operation=network-corrupt-{step} packet mutation"
                    );
                }
                _ => {
                    now_ms = safe(now_ms.get().saturating_add(1));
                    let _ = replay(
                        seed,
                        format!("clock-state-{step}"),
                        clock.advance(safe(step as u64 % 3)),
                    )?;
                }
            }
            let after = network.snapshot();
            assert_eq!(
                after.seed,
                seed.to_string(),
                "seed={seed} operation=network-state-{step} canonical seed diagnostic"
            );
            assert!(
                after
                    .queue
                    .windows(2)
                    .all(|packets| packets[0].packet_id != packets[1].packet_id),
                "seed={seed} operation=network-state-{step} packet IDs remain unique"
            );
            assert!(
                after.reordered_packet_ids.iter().all(|packet_id| after
                    .queue
                    .iter()
                    .any(|packet| packet.packet_id == *packet_id)),
                "seed={seed} operation=network-state-{step} reorder markers have no leaked packet IDs"
            );
            assert_eq!(
                after.queue.len(),
                after
                    .queue
                    .iter()
                    .map(|packet| packet.packet_id)
                    .collect::<BTreeSet<_>>()
                    .len(),
                "seed={seed} operation=network-state-{step} queue identity set"
            );
            assert!(
                !clock
                    .timers
                    .keys()
                    .any(|(endpoint, _)| *endpoint != endpoints[0] && *endpoint != endpoints[1]),
                "seed={seed} operation=clock-state-{step} endpoint resource scope"
            );
        }

        let mut invalid_reorder = FaultNetworkProperty::new(seed, endpoints);
        let invalid_packet = replay(
            seed,
            "network-invalid-enqueue",
            invalid_reorder.enqueue(
                endpoints[0],
                endpoints[1],
                ConnectionGeneration::ZERO,
                7,
                SafeU53::ZERO,
            ),
        )?;
        let before_invalid_reorder = invalid_reorder.snapshot();
        assert!(
            invalid_reorder
                .reorder(vec![invalid_packet, invalid_packet])
                .is_err(),
            "seed={seed} operation=network-invalid-reorder duplicate packet rejects"
        );
        assert_eq!(
            invalid_reorder.snapshot(),
            before_invalid_reorder,
            "seed={seed} operation=network-invalid-reorder is fail-atomic"
        );
        invalid_reorder.queue[0].deliver_at_ms = SafeU53::MAX;
        let before_invalid_delay = invalid_reorder.snapshot();
        assert!(
            invalid_reorder
                .delay(
                    invalid_packet,
                    SafeU53::new(1).expect("one-millisecond delay fixture must fit SafeU53")
                )
                .is_err(),
            "seed={seed} operation=network-invalid-delay overflow rejects"
        );
        assert_eq!(
            invalid_reorder.snapshot(),
            before_invalid_delay,
            "seed={seed} operation=network-invalid-delay is fail-atomic"
        );
        invalid_reorder.next_packet_id = SafeU53::MAX.get() + 1;
        let before_packet_exhaustion = invalid_reorder.snapshot();
        assert!(
            invalid_reorder
                .enqueue(
                    endpoints[0],
                    endpoints[1],
                    ConnectionGeneration::ZERO,
                    8,
                    SafeU53::ZERO
                )
                .is_err(),
            "seed={seed} operation=network-packet-id-exhaustion rejects"
        );
        assert_eq!(
            invalid_reorder.snapshot(),
            before_packet_exhaustion,
            "seed={seed} operation=network-packet-id-exhaustion is fail-atomic"
        );
        invalid_reorder
            .generations
            .insert(endpoints[0], ConnectionGeneration::new(SafeU53::MAX));
        invalid_reorder
            .generations
            .insert(endpoints[1], ConnectionGeneration::new(SafeU53::MAX));
        let before_generation_exhaustion = invalid_reorder.snapshot();
        assert!(
            invalid_reorder.reconnect(endpoints[0]).is_err(),
            "seed={seed} operation=network-generation-exhaustion rejects"
        );
        assert_eq!(
            invalid_reorder.snapshot(),
            before_generation_exhaustion,
            "seed={seed} operation=network-generation-exhaustion is fail-atomic"
        );
        let before_clock_overflow = clock.clone();
        clock.now_ms = SafeU53::MAX;
        let overflow_snapshot = clock.clone();
        assert!(
            clock.advance(safe(1)).is_err(),
            "seed={seed} operation=clock-time-overflow rejects"
        );
        assert_eq!(
            clock, overflow_snapshot,
            "seed={seed} operation=clock-time-overflow is fail-atomic"
        );
        assert_ne!(
            before_clock_overflow, clock,
            "seed={seed} operation=clock-overflow fixture reached max boundary"
        );
        clock.dispose();
        network.dispose();
        assert!(
            clock.timers.is_empty(),
            "seed={seed} operation=clock-disposal no timers"
        );
        assert!(
            network.queue.is_empty(),
            "seed={seed} operation=network-disposal no queued packets"
        );
        assert!(
            network.reordered_packet_ids.is_empty(),
            "seed={seed} operation=network-disposal no reorder markers"
        );
        assert!(
            network.disconnected.is_empty() && network.suspended.is_empty(),
            "seed={seed} operation=network-disposal no endpoint resources"
        );
        assert!(
            network.snapshot().disposed,
            "seed={seed} operation=network-disposal disposed diagnostic"
        );
    }
    Ok(())
}

#[test]
fn authority_log_seeded_commit_receipt_and_recovery_properties() -> TestResult {
    for seed in 0..8_u64 {
        let capacity = 2 + seed % 3;
        let mut log = replay(seed, "authority-init", authority_log(capacity, &[(1, 4)]))?;
        let mut scheduler = KernelScheduler::new();
        let authority = replay(seed, "authority-context", authority_context())?;
        let invalid = replay(
            seed,
            "invalid-draft",
            draft(
                &authority,
                &format!("invalid-{seed}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, Vec::new()),
            ),
        )?;
        assert!(
            matches!(
                log.commit(invalid, &mut scheduler),
                Err(er_protocol::AuthorityLogError::InvalidEntry { .. })
            ),
            "seed={seed} operation=invalid invalid commit"
        );
        assert_eq!(
            log.head_revision(),
            Revision::ZERO,
            "seed={seed} operation=invalid invalid commit preserves revision"
        );

        for value in 1..=capacity {
            let commit_draft = replay(
                seed,
                format!("draft-{value}"),
                draft(
                    &authority,
                    &format!("operation-{seed}-{value}"),
                    AuthorityEntryKind::TurnCommit,
                    json!({"epoch": 3, "wave": 4, "turn": 1}),
                    command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
                ),
            )?;
            let outcome = replay(
                seed,
                format!("commit-{value}"),
                log.commit(commit_draft, &mut scheduler),
            )?;
            assert_eq!(
                outcome.entry.revision,
                revision(value),
                "seed={seed} operation={value} revision"
            );
            assert_authority_delivery_actions(
                &outcome.actions,
                &outcome.entry,
                &[1],
                value - 1,
                seed,
                &format!("commit-{value}"),
            );
            assert_eq!(
                log.head_revision(),
                revision(value),
                "seed={seed} operation={value} monotonic head"
            );
            assert_eq!(
                log.retained().len(),
                value as usize,
                "seed={seed} operation={value} retained count"
            );
        }

        let overflow_draft = replay(
            seed,
            "capacity-overflow-draft",
            draft(
                &authority,
                &format!("overflow-{seed}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            ),
        )?;
        let overflow = log.commit(overflow_draft, &mut scheduler);
        assert!(
            matches!(overflow, Err(er_protocol::AuthorityLogError::RetentionOverflow { attempted_revision, .. }) if attempted_revision == revision(capacity + 1)),
            "seed={seed} operation=capacity capacity overflow"
        );
        assert_eq!(
            log.head_revision(),
            revision(capacity),
            "seed={seed} operation=capacity capacity refusal preserves head frontier"
        );
        assert_eq!(
            log.diagnostics().capacity_refusals,
            safe(1),
            "seed={seed} operation=capacity capacity refusal count"
        );
        let slice = log.recovery_slice(Revision::ZERO);
        let slice = slice.ok_or_else(|| {
            missing(format!(
                "seed={seed} operation=recovery-slice dense recovery slice missing"
            ))
        })?;
        assert_eq!(
            slice.required_tail.len(),
            capacity as usize,
            "seed={seed} operation=recovery-slice recovery tail length"
        );
        assert_eq!(
            slice.required_tail.first().map(|entry| entry.revision),
            Some(revision(1)),
            "seed={seed} operation=recovery-slice recovery tail start"
        );
        assert_eq!(
            slice.required_tail.last().map(|entry| entry.revision),
            Some(revision(capacity)),
            "seed={seed} operation=recovery-slice recovery tail end"
        );
        let equal = log.recovery_slice(revision(capacity));
        assert!(
            equal.is_some(),
            "seed={seed} operation=recovery-equal equal frontier recovery proof"
        );
        assert_eq!(
            equal.as_ref().map(|slice| slice.required_tail.len()),
            Some(1),
            "seed={seed} operation=recovery-equal equal frontier reconstruction"
        );
        let _ = log.dispose("property teardown", &mut scheduler);
        assert!(
            log.diagnostics().disposed,
            "seed={seed} operation=disposal disposed log"
        );
        assert!(
            log.retained().is_empty(),
            "seed={seed} operation=disposal retained entries after disposal"
        );
        assert!(
            scheduler.live_timers().is_empty(),
            "seed={seed} operation=disposal scheduler resource zero"
        );
        assert_eq!(
            log.dispose("duplicate", &mut scheduler),
            Vec::new(),
            "seed={seed} operation=disposal disposal idempotence"
        );
    }

    let mut prepared_log = authority_log(4, &[(1, 4)])?;
    let mut prepared_scheduler = KernelScheduler::new();
    let authority = authority_context()?;
    let prepared = prepared_log.prepare_commit(draft(
        &authority,
        "prepared-1",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
    )?)?;
    assert_eq!(prepared.token, safe(1), "seed=8 operation=prepared token");
    assert_eq!(
        prepared_log.head_revision(),
        Revision::ZERO,
        "seed=8 operation=prepared head remains unpublished"
    );
    assert!(
        prepared_log.retained().is_empty(),
        "seed=8 operation=prepared retention remains unpublished"
    );
    let published = prepared_log.publish_prepared(prepared.token, &mut prepared_scheduler)?;
    assert_eq!(
        published.entry.revision,
        revision(1),
        "seed=8 operation=publish revision"
    );
    assert_authority_delivery_actions(&published.actions, &published.entry, &[1], 0, 8, "publish");

    let mut superseding_draft = draft(
        &authority,
        "prepared-2",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
    )?;
    superseding_draft.subsumes = vec![revision(1)];
    let superseding = prepared_log.prepare_commit(superseding_draft)?;
    let published_superseding =
        prepared_log.publish_prepared(superseding.token, &mut prepared_scheduler)?;
    assert_authority_delivery_actions(
        &published_superseding.actions,
        &published_superseding.entry,
        &[1],
        1,
        8,
        "supersession-publish",
    );
    let supersession_receipt = prepared_log.accept_receipt_detailed(
        receipt_for(&published_superseding.entry, 1, 4, AckStage::Admitted, None)?,
        &mut prepared_scheduler,
    );
    assert!(matches!(
        supersession_receipt.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(1)]
    ));
    assert_eq!(
        supersession_receipt.actions,
        vec![AuthorityLogAction::Scheduler {
            command: SchedulerCommand::Cancel {
                endpoint: seat(0),
                timer_id: TimerId::new(safe(0)),
            },
        }],
        "seed=8 operation=supersession prior lease cancellation"
    );
    assert!(
        prepared_log.retained_entry(revision(1)).is_none(),
        "seed=8 operation=supersession prior entry retired"
    );
    assert!(
        prepared_log.retained_entry(revision(2)).is_some(),
        "seed=8 operation=supersession successor retained"
    );
    let rejected_prepared = prepared_log.prepare_commit(draft(
        &authority,
        "prepared-rejected",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
    )?)?;
    assert!(
        prepared_log.reject_prepared(rejected_prepared.token),
        "seed=8 operation=prepared-reject removes live preparation"
    );
    assert_eq!(
        prepared_log.head_revision(),
        revision(2),
        "seed=8 operation=prepared-reject head unchanged"
    );
    assert_eq!(
        prepared_log.diagnostics().delivery_timer_ids,
        BTreeSet::from([TimerId::new(safe(1))]),
        "seed=8 operation=prepared-reject live timer unchanged"
    );
    let _ = prepared_log.dispose("prepared teardown", &mut prepared_scheduler);
    assert!(
        prepared_scheduler.live_timers().is_empty(),
        "seed=8 operation=prepared-cleanup resources"
    );

    let mut log = authority_log(4, &[(1, 4), (2, 4)])?;
    let mut scheduler = KernelScheduler::new();
    let authority = authority_context()?;
    let receipt_commit = log.commit(
        draft(
            &authority,
            "receipt-operation",
            AuthorityEntryKind::TurnCommit,
            json!({"epoch": 3, "wave": 4, "turn": 1}),
            command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
        )?,
        &mut scheduler,
    )?;
    assert_authority_delivery_actions(
        &receipt_commit.actions,
        &receipt_commit.entry,
        &[1, 2],
        0,
        8,
        "receipt-commit",
    );
    let entry = receipt_commit.entry;
    let control_id = GOLDEN_AUTHORITY_CONTROL_ID.to_owned();
    assert_eq!(
        control_id_of(&entry.next_control),
        GOLDEN_AUTHORITY_CONTROL_ID,
        "seed=8 operation=receipt golden control id"
    );

    let admitted = log.accept_receipt_detailed(
        receipt_for(&entry, 1, 4, AckStage::Admitted, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        admitted.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(1), seat(2)]
    ));
    assert!(
        admitted.actions.is_empty(),
        "seed=8 operation=receipt-admitted no retirement before quorum"
    );
    let duplicate = log.accept_receipt_detailed(
        receipt_for(&entry, 1, 4, AckStage::Admitted, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        duplicate.verdict,
        AuthorityReceiptVerdict::Duplicate {
            highest_stage: AckStage::Admitted
        }
    ));
    let before_mechanical_diagnostics = log.diagnostics();
    let before_mechanical_timers = scheduler.live_timers();
    let before_mechanical = log.accept_receipt_detailed(
        receipt_for(&entry, 1, 4, AckStage::PresentationSettled, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        before_mechanical.verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::PresentationBeforeMechanical
        }
    ));
    assert_eq!(
        log.diagnostics(),
        before_mechanical_diagnostics,
        "seed=8 operation=receipt-order rejected receipt atomic diagnostics"
    );
    assert_eq!(
        scheduler.live_timers(),
        before_mechanical_timers,
        "seed=8 operation=receipt-order rejected receipt atomic timers"
    );
    let material = log.accept_receipt_detailed(
        receipt_for(&entry, 1, 4, AckStage::MaterialApplied, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        material.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(1), seat(2)]
    ));
    let before_wrong_control_diagnostics = log.diagnostics();
    let before_wrong_control_timers = scheduler.live_timers();
    let wrong_control = log.accept_receipt_detailed(
        receipt_for(
            &entry,
            1,
            4,
            AckStage::ControlInstalled,
            Some("wrong".to_owned()),
        )?,
        &mut scheduler,
    );
    assert!(matches!(
        wrong_control.verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::ControlIdMismatch
        }
    ));
    assert_eq!(
        log.diagnostics(),
        before_wrong_control_diagnostics,
        "seed=8 operation=receipt-control rejected receipt atomic diagnostics"
    );
    assert_eq!(
        scheduler.live_timers(),
        before_wrong_control_timers,
        "seed=8 operation=receipt-control rejected receipt atomic timers"
    );
    let installed_one = log.accept_receipt_detailed(
        receipt_for(
            &entry,
            1,
            4,
            AckStage::ControlInstalled,
            Some(control_id.clone()),
        )?,
        &mut scheduler,
    );
    assert!(matches!(
        installed_one.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(2)]
    ));
    let settled_one = log.accept_receipt_detailed(
        receipt_for(&entry, 1, 4, AckStage::PresentationSettled, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        settled_one.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(2)]
    ));
    assert!(
        settled_one.actions.is_empty(),
        "seed=8 operation=receipt-presentation settlement does not retire before quorum"
    );
    let self_signed = log.accept_receipt_detailed(
        receipt_for(&entry, 0, 1, AckStage::Admitted, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        self_signed.verdict,
        AuthorityReceiptVerdict::Rejected {
            reason: ReceiptRejectReason::SelfSigned | ReceiptRejectReason::AuthoritySigned
        }
    ));
    let admitted_two = log.accept_receipt_detailed(
        receipt_for(&entry, 2, 4, AckStage::Admitted, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        admitted_two.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(2)]
    ));
    let material_two = log.accept_receipt_detailed(
        receipt_for(&entry, 2, 4, AckStage::MaterialApplied, None)?,
        &mut scheduler,
    );
    assert!(matches!(
        material_two.verdict,
        AuthorityReceiptVerdict::Advanced { retired: false, waiting_for_seat_ids }
            if waiting_for_seat_ids == vec![seat(2)]
    ));
    let installed_two = log.accept_receipt_detailed(
        receipt_for(&entry, 2, 4, AckStage::ControlInstalled, Some(control_id))?,
        &mut scheduler,
    );
    assert!(matches!(
        installed_two.verdict,
        AuthorityReceiptVerdict::Advanced { retired: true, waiting_for_seat_ids }
            if waiting_for_seat_ids.is_empty()
    ));
    assert_eq!(
        installed_two.actions,
        vec![AuthorityLogAction::Scheduler {
            command: SchedulerCommand::Cancel {
                endpoint: seat(0),
                timer_id: TimerId::new(safe(0)),
            },
        }],
        "seed=8 operation=receipt-final exact terminal cancellation"
    );
    assert!(log.retained().is_empty());
    assert!(log.peer_stage_quorum(&entry.operation_id, AckStage::ControlInstalled));
    assert!(log.diagnostics().delivery_timer_ids.is_empty());
    log.dispose("receipt teardown", &mut scheduler);
    assert!(
        log.diagnostics().disposed,
        "seed=8 operation=receipt cleanup disposed log"
    );
    assert!(
        scheduler.live_timers().is_empty(),
        "seed=8 operation=receipt cleanup resources"
    );
    Ok(())
}

#[test]
fn authority_scheduler_continuations_rebind_and_schedule_failure_are_atomic() -> TestResult {
    for seed in 0..4_u64 {
        let mut log = replay(seed, "authority-timer-init", authority_log(4, &[(1, 4)]))?;
        let mut scheduler = KernelScheduler::new();
        let authority = replay(seed, "authority-timer-context", authority_context())?;
        let timer_draft = replay(
            seed,
            "authority-timer-draft",
            draft(
                &authority,
                &format!("authority-timer-{seed}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            ),
        )?;
        let outcome = replay(
            seed,
            "authority-timer-commit",
            log.commit(timer_draft, &mut scheduler),
        )?;
        assert_authority_delivery_actions(
            &outcome.actions,
            &outcome.entry,
            &[1],
            0,
            seed,
            "authority-timer-commit",
        );
        let timer = match outcome.actions.first() {
            Some(AuthorityLogAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            }) => timer.clone(),
            other => {
                return Err(missing(format!(
                    "seed={seed} operation=0 authority schedule index was {other:?}"
                )));
            }
        };
        let unauthorized_draft = replay(
            seed,
            "authority-unauthorized-draft",
            draft(
                &authority,
                &format!("authority-unauthorized-successor-{seed}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 4}),
                command_control(3, 4, 4, vec![command_target(0, 0, 7)]),
            ),
        )?;
        let unauthorized_successor = log.commit(unauthorized_draft, &mut scheduler);
        assert!(
            matches!(
                unauthorized_successor,
                Err(er_protocol::AuthorityLogError::SuccessorRejected)
            ),
            "seed={seed} operation=1 predecessor successor authorization"
        );
        assert_eq!(
            log.head_revision(),
            revision(1),
            "seed={seed} operation=1 successor rejection preserves frontier"
        );
        let live_before_rebind = scheduler.live_timers();

        let rebound = replay(
            seed,
            "authority-rebind",
            log.rebind_connection(
                replay(seed, "authority-rebind-context", context(0, 0, 2, 2, 3))?,
                vec![er_protocol::PeerBinding {
                    seat_id: seat(1),
                    connection_generation: generation(5),
                }],
            ),
        )?;
        let mut rebound_entry = outcome.entry.clone();
        rebound_entry.context.connection_generation = generation(2);
        assert_eq!(
            rebound.retained_count,
            safe(1),
            "seed={seed} operation=1 rebind retained count"
        );
        assert_eq!(
            scheduler.live_timers(),
            live_before_rebind,
            "seed={seed} operation=1 rebind preserves scheduler registrations"
        );
        assert_authority_delivery_only(
            &rebound.actions,
            &rebound_entry,
            &[1],
            seed,
            "authority-rebind-delivery",
        );
        let unchanged_context = replay(
            seed,
            "authority-rebind-unchanged-context",
            context(0, 0, 2, 2, 3),
        )?;
        let unchanged_rebind = replay(
            seed,
            "authority-rebind-unchanged",
            log.rebind_connection(
                unchanged_context,
                vec![er_protocol::PeerBinding {
                    seat_id: seat(1),
                    connection_generation: generation(5),
                }],
            ),
        )?;
        assert_eq!(
            unchanged_rebind.retained_count,
            SafeU53::ZERO,
            "seed={seed} operation=1b unchanged rebind count"
        );
        assert!(
            unchanged_rebind.actions.is_empty(),
            "seed={seed} operation=1b unchanged rebind actions"
        );
        let before_invalid_rebind = log.diagnostics();
        let before_invalid_rebind_scheduler = scheduler_snapshot(&scheduler);
        assert!(
            log.rebind_connection(
                replay(
                    seed,
                    "authority-invalid-rebind-context",
                    context(0, 0, 1, 2, 3)
                )?,
                vec![er_protocol::PeerBinding {
                    seat_id: seat(1),
                    connection_generation: generation(4),
                }],
            )
            .is_err(),
            "seed={seed} operation=2 rebind rejects membership/generation rollback"
        );
        assert_eq!(
            log.diagnostics(),
            before_invalid_rebind,
            "seed={seed} operation=2 failed rebind is atomic"
        );
        assert_eq!(
            scheduler_snapshot(&scheduler),
            before_invalid_rebind_scheduler,
            "seed={seed} operation=2 failed rebind preserves complete scheduler resources"
        );

        let stale_receipt = log.accept_receipt_detailed(
            replay(
                seed,
                "authority-stale-receipt",
                receipt_for(&outcome.entry, 1, 3, AckStage::Admitted, None),
            )?,
            &mut scheduler,
        );
        assert!(
            matches!(
                stale_receipt.verdict,
                AuthorityReceiptVerdict::Rejected {
                    reason: ReceiptRejectReason::ConnectionGenerationMismatch
                }
            ),
            "seed={seed} operation=2 stale receipt generation"
        );
        assert!(
            stale_receipt.actions.is_empty(),
            "seed={seed} operation=2 stale receipt has no action"
        );

        let removed_timer = replay(
            seed,
            "authority-fire-timer",
            fire_exact_timer(&mut scheduler, &timer, seed, 3),
        )?;
        let mut invalid_timer = removed_timer.clone();
        invalid_timer.delay_ms = safe(251);
        let before_invalid_timer = log.diagnostics();
        let before_invalid_timer_scheduler = scheduler_snapshot(&scheduler);
        assert!(
            log.timer_fired(invalid_timer, &mut scheduler).is_err(),
            "seed={seed} operation=3 stale delivery timer rejected"
        );
        assert_eq!(
            log.diagnostics(),
            before_invalid_timer,
            "seed={seed} operation=3 stale delivery timer preserves lease"
        );
        assert_eq!(
            scheduler_snapshot(&scheduler),
            before_invalid_timer_scheduler,
            "seed={seed} operation=3 stale delivery timer preserves complete scheduler resources"
        );
        let actions = replay(
            seed,
            "authority-timer-continuation",
            log.timer_fired(removed_timer, &mut scheduler),
        )?;
        assert_eq!(
            actions.len(),
            2,
            "seed={seed} operation=4 continuation schedule precedes delivery"
        );
        let continuation = match &actions[0] {
            AuthorityLogAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            } => timer,
            other => panic!("seed={seed} operation=4 continuation first action was {other:?}"),
        };
        assert_eq!(
            continuation.timer_id,
            TimerId::new(safe(1)),
            "seed={seed} operation=4 continuation timer id"
        );
        assert_eq!(
            continuation.endpoint,
            seat(0),
            "seed={seed} operation=4 continuation endpoint"
        );
        assert_eq!(
            continuation.owner,
            timer_owner(
                "authority-v2-property:delivery:1",
                "authority-log/delivery/1",
                "redeliver revision 1 until mechanical quorum"
            ),
            "seed={seed} operation=4 continuation owner"
        );
        assert_eq!(
            continuation.delay_ms,
            safe(500),
            "seed={seed} operation=4 continuation delay"
        );
        assert_eq!(
            continuation.time_class,
            TimeClass::Connected,
            "seed={seed} operation=4 continuation class"
        );
        assert_authority_delivery_only(
            &actions[1..],
            &rebound_entry,
            &[1],
            seed,
            "authority-timer-delivery",
        );
        let next = replay(
            seed,
            "authority-fire-attempt-2",
            fire_exact_timer(&mut scheduler, continuation, seed, 5),
        )?;
        let attempt_two = replay(
            seed,
            "authority-attempt-2",
            log.timer_fired(next, &mut scheduler),
        )?;
        assert_eq!(
            attempt_two.len(),
            2,
            "seed={seed} operation=5 retry schedule precedes delivery"
        );
        let attempt_two_timer = match &attempt_two[0] {
            AuthorityLogAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            } => timer,
            other => panic!("seed={seed} operation=5 retry first action was {other:?}"),
        };
        assert_eq!(
            attempt_two_timer.timer_id,
            TimerId::new(safe(2)),
            "seed={seed} operation=5 retry timer id"
        );
        assert_eq!(
            attempt_two_timer.endpoint,
            seat(0),
            "seed={seed} operation=5 retry endpoint"
        );
        assert_eq!(
            attempt_two_timer.owner,
            timer_owner(
                "authority-v2-property:delivery:1",
                "authority-log/delivery/1",
                "redeliver revision 1 until mechanical quorum"
            ),
            "seed={seed} operation=5 retry owner"
        );
        assert_eq!(
            attempt_two_timer.delay_ms,
            safe(1_000),
            "seed={seed} operation=5 retry delay"
        );
        assert_eq!(
            attempt_two_timer.time_class,
            TimeClass::Connected,
            "seed={seed} operation=5 retry class"
        );
        assert_authority_delivery_only(
            &attempt_two[1..],
            &rebound_entry,
            &[1],
            seed,
            "authority-attempt-2-delivery",
        );
        let next = replay(
            seed,
            "authority-fire-attempt-3",
            fire_exact_timer(&mut scheduler, attempt_two_timer, seed, 6),
        )?;
        let attempt_three = replay(
            seed,
            "authority-attempt-3",
            log.timer_fired(next, &mut scheduler),
        )?;
        assert_eq!(
            attempt_three.len(),
            2,
            "seed={seed} operation=6 retry schedule precedes delivery"
        );
        let attempt_three_timer = match &attempt_three[0] {
            AuthorityLogAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            } => timer,
            other => panic!("seed={seed} operation=6 retry first action was {other:?}"),
        };
        assert_eq!(
            attempt_three_timer.timer_id,
            TimerId::new(safe(3)),
            "seed={seed} operation=6 retry timer id"
        );
        assert_eq!(
            attempt_three_timer.endpoint,
            seat(0),
            "seed={seed} operation=6 retry endpoint"
        );
        assert_eq!(
            attempt_three_timer.owner,
            timer_owner(
                "authority-v2-property:delivery:1",
                "authority-log/delivery/1",
                "redeliver revision 1 until mechanical quorum"
            ),
            "seed={seed} operation=6 retry owner"
        );
        assert_eq!(
            attempt_three_timer.delay_ms,
            safe(2_000),
            "seed={seed} operation=6 retry delay"
        );
        assert_eq!(
            attempt_three_timer.time_class,
            TimeClass::Connected,
            "seed={seed} operation=6 retry class"
        );
        assert_authority_delivery_only(
            &attempt_three[1..],
            &rebound_entry,
            &[1],
            seed,
            "authority-attempt-3-delivery",
        );
        let next = replay(
            seed,
            "authority-fire-attempt-4",
            fire_exact_timer(&mut scheduler, attempt_three_timer, seed, 7),
        )?;
        let terminal_attempt = replay(
            seed,
            "authority-attempt-4",
            log.timer_fired(next, &mut scheduler),
        )?;
        assert_eq!(
            terminal_attempt.len(),
            1,
            "seed={seed} operation=7 exhausted retry emits delivery only"
        );
        assert_authority_delivery_only(
            &terminal_attempt,
            &rebound_entry,
            &[1],
            seed,
            "authority-attempt-4-delivery",
        );
        assert!(
            scheduler.live_timers().is_empty(),
            "seed={seed} operation=7 exhausted retry resources"
        );

        let _ = log.dispose("seed teardown", &mut scheduler);
        assert!(
            scheduler.live_timers().is_empty(),
            "seed={seed} operation=5 disposal resource zero"
        );

        let mut failed_scheduler = KernelScheduler::new();
        let _ = failed_scheduler.dispose();
        let mut rollback_log =
            replay(seed, "authority-rollback-init", authority_log(2, &[(1, 4)]))?;
        let failed_draft = replay(
            seed,
            "authority-rollback-draft",
            draft(
                &authority,
                &format!("authority-rollback-{seed}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            ),
        )?;
        let failed = rollback_log.commit(failed_draft, &mut failed_scheduler);
        assert!(
            matches!(
                failed,
                Err(er_protocol::AuthorityLogError::Scheduler(
                    SchedulerError::Disposed
                ))
            ),
            "seed={seed} operation=6 schedule exhaustion error"
        );
        assert_eq!(
            rollback_log.head_revision(),
            Revision::ZERO,
            "seed={seed} operation=6 revision rollback"
        );
        assert!(
            rollback_log.retained().is_empty(),
            "seed={seed} operation=6 retention rollback"
        );
        assert!(
            rollback_log.diagnostics().delivery_timer_ids.is_empty(),
            "seed={seed} operation=6 timer rollback"
        );

        let mut retry_scheduler = KernelScheduler::new();
        let retry_draft = replay(
            seed,
            "authority-rollback-retry-draft",
            draft(
                &authority,
                &format!("authority-rollback-retry-{seed}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            ),
        )?;
        let retry = replay(
            seed,
            "authority-rollback-retry-commit",
            rollback_log.commit(retry_draft, &mut retry_scheduler),
        )?;
        assert_eq!(
            retry.entry.revision,
            revision(1),
            "seed={seed} operation=7 retry revision"
        );
        let _ = rollback_log.dispose("retry teardown", &mut retry_scheduler);
        assert!(
            retry_scheduler.live_timers().is_empty(),
            "seed={seed} operation=7 retry disposal"
        );
    }
    Ok(())
}

#[test]
fn replica_seeded_pipeline_has_one_incomplete_entry_and_monotonic_frontiers() -> TestResult {
    for seed in 0..10_u64 {
        let mut replica = replay(seed, "replica-init", replica())?;
        let first = replay(
            seed,
            "replica-entry-1",
            replica_entry(1, &format!("replica-{seed}-1")),
        )?;
        let admitted = replica.admit(first.clone());
        assert!(
            matches!(
                admitted.admission,
                ReplicaAdmission::Admitted {
                    resume: ReplicaResume::Admitted
                }
            ),
            "seed={seed} operation=admit-1 first admission"
        );
        assert_replica_admitted_actions(&admitted.actions, &first, seed, "admit-1");
        assert_eq!(
            replica.frontier(),
            AuthorityFrontier {
                received: revision(1),
                material: Revision::ZERO,
                control: Revision::ZERO
            },
            "seed={seed} operation=admit-1 admitted frontier"
        );
        assert_replica_frontier_invariants(&replica, seed, "admitted");

        let duplicate = replica.admit(first.clone());
        assert!(
            matches!(
                duplicate.admission,
                ReplicaAdmission::Duplicate {
                    resume: ReplicaResume::Admitted
                }
            ),
            "seed={seed} operation=admit-2 material retry classification"
        );
        assert_replica_admitted_actions(&duplicate.actions, &first, seed, "admit-2");
        assert_replica_frontier_invariants(&replica, seed, "duplicate-material");
        assert!(
            replica
                .material_result(revision(1), MaterialApplicationOutcome::Deferred)
                .map_err(|error| missing(format!("seed={seed} operation=material-1: {error}")))?
                .is_empty(),
            "seed={seed} operation=material-1 deferred material has no receipt"
        );
        assert_replica_frontier_invariants(&replica, seed, "material-deferred");
        let material = replica
            .material_result(revision(1), MaterialApplicationOutcome::Applied)
            .map_err(|error| missing(format!("seed={seed} operation=material-2: {error}")))?;
        assert_replica_material_actions(
            &material,
            &first,
            GOLDEN_REPLICA_CONTROL_ID,
            seed,
            "material-2",
        );
        assert_eq!(
            replica.frontier(),
            AuthorityFrontier {
                received: revision(1),
                material: revision(1),
                control: Revision::ZERO
            },
            "seed={seed} operation=material-2 material frontier"
        );
        assert_replica_frontier_invariants(&replica, seed, "material-applied");

        let duplicate_control = replica.admit(first.clone());
        assert!(
            matches!(
                duplicate_control.admission,
                ReplicaAdmission::Duplicate {
                    resume: ReplicaResume::MaterialApplied
                }
            ),
            "seed={seed} operation=admit-3 control retry classification"
        );
        assert_replica_material_actions(
            &duplicate_control.actions,
            &first,
            GOLDEN_REPLICA_CONTROL_ID,
            seed,
            "admit-3",
        );
        assert_replica_frontier_invariants(&replica, seed, "duplicate-control");
        assert!(
            replica
                .control_result(revision(1), ControlProjectionOutcome::Deferred)
                .map_err(|error| missing(format!("seed={seed} operation=control-1: {error}")))?
                .is_empty(),
            "seed={seed} operation=control-1 deferred control has no receipt"
        );
        assert_replica_frontier_invariants(&replica, seed, "control-deferred");
        let control_id = GOLDEN_REPLICA_CONTROL_ID.to_owned();
        assert_eq!(
            control_id_of(&first.next_control),
            GOLDEN_REPLICA_CONTROL_ID,
            "seed={seed} operation=control-id golden identity"
        );
        let installed = replica
            .control_result(
                revision(1),
                ControlProjectionOutcome::Installed {
                    control_id: control_id.clone(),
                },
            )
            .map_err(|error| missing(format!("seed={seed} operation=control-2: {error}")))?;
        assert_replica_control_actions(
            &installed,
            &first,
            GOLDEN_REPLICA_CONTROL_ID,
            seed,
            "control-2",
        );
        assert_eq!(
            replica.frontier(),
            AuthorityFrontier {
                received: revision(1),
                material: revision(1),
                control: revision(1)
            },
            "seed={seed} operation=control-2 complete frontier"
        );
        assert!(
            replica.pending_entry().is_none(),
            "seed={seed} operation=control-2 pending entry after control"
        );
        assert_replica_frontier_invariants(&replica, seed, "control-installed");

        let pending_presentation = replica
            .presentation_result(revision(1), PresentationProbeOutcome::Pending)
            .map_err(|error| {
                missing(format!(
                    "seed={seed} operation=presentation-pending: {error}"
                ))
            })?;
        assert!(
            pending_presentation.is_empty(),
            "seed={seed} operation=presentation-pending no receipt"
        );
        let settled_presentation = replica
            .presentation_result(revision(1), PresentationProbeOutcome::Settled)
            .map_err(|error| {
                missing(format!(
                    "seed={seed} operation=presentation-settled: {error}"
                ))
            })?;
        match settled_presentation.as_slice() {
            [ReplicaAction::EmitReceipt { receipt }] => {
                assert_eq!(
                    receipt.revision,
                    revision(1),
                    "seed={seed} operation=presentation-settled revision"
                );
                assert_eq!(
                    receipt.operation_id, first.operation_id,
                    "seed={seed} operation=presentation-settled operation"
                );
                assert_eq!(
                    receipt.stage,
                    AckStage::PresentationSettled,
                    "seed={seed} operation=presentation-settled stage"
                );
                assert_eq!(
                    receipt.control_id, None,
                    "seed={seed} operation=presentation-settled control id"
                );
            }
            other => {
                panic!("seed={seed} operation=presentation-settled action order was {other:?}")
            }
        }

        let second = replay(
            seed,
            "replica-entry-2",
            replica_entry(2, &format!("replica-{seed}-2")),
        )?;
        let second_admission = replica.admit(second.clone());
        assert!(
            matches!(
                second_admission.admission,
                ReplicaAdmission::Admitted { .. }
            ),
            "seed={seed} operation=admit-4 second admission"
        );
        assert_replica_admitted_actions(&second_admission.actions, &second, seed, "admit-4");
        assert_replica_frontier_invariants(&replica, seed, "second-admitted");
        let conflict = replay(
            seed,
            "replica-entry-conflict",
            replica_entry(2, &format!("replica-{seed}-conflict")),
        )?;
        let before_conflict = replica.diagnostics();
        let conflict_step = replica.admit(conflict);
        assert!(
            matches!(
                conflict_step.admission,
                ReplicaAdmission::Rejected {
                    reason: ReplicaRejectReason::RevisionIdentityConflict
                }
            ),
            "seed={seed} operation=admit-5 same-revision conflict"
        );
        assert!(
            conflict_step.actions.is_empty(),
            "seed={seed} operation=admit-5 conflict has no action"
        );
        assert_eq!(
            replica.diagnostics(),
            before_conflict,
            "seed={seed} operation=admit-5 conflict fail-atomic snapshot"
        );
        let blocked_entry = replay(
            seed,
            "replica-entry-3",
            replica_entry(3, &format!("replica-{seed}-3")),
        )?;
        let blocked = replica.admit(blocked_entry);
        assert!(
            matches!(blocked.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(2)),
            "seed={seed} operation=admit-6 N+1 blocked before N material/control"
        );
        let expected_replica_context = replay(seed, "replica-gap-context", replica_context())?;
        assert_eq!(
            blocked.actions,
            vec![ReplicaAction::RequestTail {
                context: expected_replica_context,
                missing_from: revision(2),
            }],
            "seed={seed} operation=admit-6 exact gap request"
        );
        assert_replica_frontier_invariants(&replica, seed, "gap-before-material");
        let second_material = replica
            .material_result(revision(2), MaterialApplicationOutcome::Applied)
            .map_err(|error| missing(format!("seed={seed} operation=second-material: {error}")))?;
        assert_replica_material_actions(
            &second_material,
            &second,
            GOLDEN_REPLICA_CONTROL_ID,
            seed,
            "second-material",
        );
        assert_replica_frontier_invariants(&replica, seed, "second-material-applied");
        let still_blocked_entry = replay(
            seed,
            "replica-entry-3b",
            replica_entry(3, &format!("replica-{seed}-3b")),
        )?;
        let still_blocked = replica.admit(still_blocked_entry);
        assert!(
            matches!(still_blocked.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(2)),
            "seed={seed} operation=admit-7 N+1 blocked while N control pending"
        );
        assert!(
            still_blocked.actions.is_empty(),
            "seed={seed} operation=admit-7 coalesced gap request"
        );
        assert_replica_frontier_invariants(&replica, seed, "gap-before-control");
        let second_control = replica
            .control_result(
                revision(2),
                ControlProjectionOutcome::Installed {
                    control_id: GOLDEN_REPLICA_CONTROL_ID.to_owned(),
                },
            )
            .map_err(|error| missing(format!("seed={seed} operation=second-control: {error}")))?;
        assert_replica_control_actions(
            &second_control,
            &second,
            GOLDEN_REPLICA_CONTROL_ID,
            seed,
            "second-control",
        );
        let third_entry = replay(
            seed,
            "replica-entry-3c",
            replica_entry(3, &format!("replica-{seed}-3c")),
        )?;
        assert!(
            matches!(
                replica.admit(third_entry).admission,
                ReplicaAdmission::Admitted { .. }
            ),
            "seed={seed} operation=admit-8 successor unblocked after control"
        );
        assert_replica_frontier_invariants(&replica, seed, "third-admitted");

        let frontier = replica.frontier();
        assert!(
            frontier.received >= frontier.material && frontier.material >= frontier.control,
            "seed={seed} operation=frontier-1 frontier ordering"
        );
        assert!(
            replica.diagnostics().pending_revision.is_none()
                || replica.diagnostics().pending_revision <= Some(frontier.received),
            "seed={seed} operation=frontier-2 pending frontier bound"
        );
        replica.dispose("seed teardown");
        assert!(
            replica.diagnostics().disposed,
            "seed={seed} operation=dispose-1 disposed replica"
        );
        assert!(
            replica.pending_entry().is_none(),
            "seed={seed} operation=dispose-2 pending entry after disposal"
        );
    }

    let mut material_rejected = replica()?;
    let rejected_entry = replica_entry(1, "replica-material-rejected")?;
    assert_replica_admitted_actions(
        &material_rejected.admit(rejected_entry.clone()).actions,
        &rejected_entry,
        10,
        "material-rejected-admit",
    );
    let before_material_rejected = material_rejected.diagnostics();
    assert_eq!(
        material_rejected.material_result(
            revision(1),
            MaterialApplicationOutcome::Rejected {
                reason: "material unavailable".to_owned(),
            },
        )?,
        vec![ReplicaAction::EnterTerminal {
            reason: "material unavailable".to_owned(),
        }],
        "seed=10 operation=material-rejected exact terminal action"
    );
    assert_eq!(
        material_rejected.diagnostics(),
        before_material_rejected,
        "seed=10 operation=material-rejected fail-atomic snapshot"
    );
    material_rejected.dispose("material rejected teardown");

    let mut control_rejected = replica()?;
    let control_rejected_entry = replica_entry(1, "replica-control-rejected")?;
    let _ = control_rejected.admit(control_rejected_entry.clone());
    let _ = control_rejected.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
    assert_eq!(
        control_rejected.control_result(
            revision(1),
            ControlProjectionOutcome::Rejected {
                reason: "control unavailable".to_owned(),
            },
        )?,
        vec![ReplicaAction::EnterTerminal {
            reason: "control unavailable".to_owned(),
        }],
        "seed=10 operation=control-rejected exact terminal action"
    );
    control_rejected.dispose("control rejected teardown");

    let mut direct_stage = replica()?;
    let direct_entry = replica_entry(1, "replica-direct-stage")?;
    let _ = direct_stage.admit(direct_entry.clone());
    let direct_material = direct_stage
        .record_replica_stage(&direct_entry, ReplicaMechanicalStage::MaterialApplied)?;
    assert_replica_material_actions(
        &direct_material,
        &direct_entry,
        GOLDEN_REPLICA_CONTROL_ID,
        10,
        "direct-material-stage",
    );
    let direct_control = direct_stage.record_replica_stage(
        &direct_entry,
        ReplicaMechanicalStage::ControlInstalled {
            control_id: GOLDEN_REPLICA_CONTROL_ID.to_owned(),
        },
    )?;
    assert_replica_control_actions(
        &direct_control,
        &direct_entry,
        GOLDEN_REPLICA_CONTROL_ID,
        10,
        "direct-control-stage",
    );
    direct_stage.dispose("direct stage teardown");

    let mut fresh = replica()?;
    assert!(
        fresh
            .material_result(revision(1), MaterialApplicationOutcome::Applied)
            .is_err()
    );
    assert_eq!(fresh.frontier(), AuthorityFrontier::default());
    assert_replica_frontier_invariants(&fresh, 10, "fresh");
    let gap = fresh.admit(replica_entry(3, "gap-3")?);
    assert!(
        matches!(gap.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(1))
    );
    assert_eq!(
        gap.actions
            .iter()
            .filter(|action| matches!(action, ReplicaAction::RequestTail { .. }))
            .count(),
        1
    );
    assert_replica_frontier_invariants(&fresh, 10, "gap-requested");
    let coalesced = fresh.admit(replica_entry(4, "gap-4")?);
    assert!(
        matches!(coalesced.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(1))
    );
    assert!(coalesced.actions.is_empty());
    assert_replica_frontier_invariants(&fresh, 10, "gap-coalesced");
    fresh.dispose("fresh gap teardown");
    assert!(
        fresh.diagnostics().disposed,
        "seed=10 operation=fresh-cleanup disposed replica"
    );

    let mut recovered = replica()?;
    let recovered_entry = replica_entry(7, "recovered-7")?;
    let stage_actions = recovered.stage_recovered_frontier(recovered_entry.clone())?;
    match stage_actions.as_slice() {
        [
            ReplicaAction::ProjectControl {
                entry,
                expected_control_id,
            },
        ] => {
            assert_eq!(
                entry, &recovered_entry,
                "seed=11 operation=recovery-stage full final entry"
            );
            assert_eq!(
                expected_control_id.as_str(),
                GOLDEN_REPLICA_CONTROL_ID,
                "seed=11 operation=recovery-stage exact control id"
            );
        }
        other => panic!("seed=11 operation=recovery-stage action order was {other:?}"),
    }
    assert_eq!(recovered.frontier().received, revision(7));
    assert_eq!(recovered.frontier().material, revision(7));
    assert_eq!(recovered.frontier().control, revision(6));
    assert_eq!(
        recovered.pending_entry().map(|entry| entry.revision),
        Some(revision(7))
    );
    assert_replica_frontier_invariants(&recovered, 11, "recovery-staged");
    assert!(
        matches!(recovered.admit(replica_entry(8, "recovered-8")?).admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(7))
    );
    let recovered_control = recovered.control_result(
        revision(7),
        ControlProjectionOutcome::Installed {
            control_id: GOLDEN_REPLICA_CONTROL_ID.to_owned(),
        },
    )?;
    assert_replica_control_actions(
        &recovered_control,
        &recovered_entry,
        GOLDEN_REPLICA_CONTROL_ID,
        11,
        "recovery-control",
    );
    assert_eq!(recovered.control_installed_through(), revision(7));
    assert_replica_frontier_invariants(&recovered, 11, "recovery-installed");
    recovered.dispose("recovery replica teardown");
    assert!(
        recovered.diagnostics().disposed,
        "seed=11 operation=recovery-cleanup disposed replica"
    );

    let mut rebound = replica()?;
    let original_frontier = rebound.frontier();
    rebound.rebind_connection(context(1, 0, 2, 3, 3)?, generation(3))?;
    assert_eq!(
        rebound.frontier(),
        original_frontier,
        "seed=12 operation=0 replica rebind preserves frontier"
    );
    let before_rollback = rebound.diagnostics();
    assert!(
        rebound
            .rebind_connection(context(1, 0, 2, 2, 3)?, generation(2))
            .is_err(),
        "seed=12 operation=1 replica rebind rejects generation rollback"
    );
    assert_eq!(
        rebound.diagnostics(),
        before_rollback,
        "seed=12 operation=1 replica rebind rollback is atomic"
    );
    rebound.dispose("rebind teardown");
    assert!(
        rebound
            .rebind_connection(context(1, 0, 2, 4, 3)?, generation(4))
            .is_err(),
        "seed=12 operation=2 disposed replica rejects rebind"
    );
    assert!(rebound.diagnostics().disposed);
    Ok(())
}

#[test]
fn proposal_seeded_generators_preserve_fingerprints_dedup_conflicts_and_tombstones() -> TestResult {
    let wire = ProposalJson::new(r#" { "z": 1, "a": { "second": 2, "first": 1 } } "#)?;
    let reward_surface = ProposalJson::new(r#"{"surfaceId":"modifier:me:graves:0","ordinal":0}"#)?;
    let expected = r#"[42,"reward",-3,{"z":1,"a":{"second":2,"first":1}},{"surfaceId":"modifier:me:graves:0","ordinal":0}]"#;
    assert_eq!(
        fingerprint_reward(
            safe(42),
            "reward",
            signed(-3),
            Some(&wire),
            Some(&reward_surface)
        )?,
        expected
    );
    assert_eq!(
        proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
            sequence: safe(42),
            label: "reward".to_owned(),
            choice: signed(-3),
            wire: Some(wire),
            reward_surface: Some(reward_surface),
        })?,
        expected
    );
    assert_eq!(
        fingerprint_biome_shop_leave(safe(12))?,
        r#"[7000012,"biomeShop",-1,null,null]"#
    );
    assert_eq!(
        fingerprint_biome_shop_buy(
            safe(12),
            signed(3),
            [signed(-4), signed(5), signed(6), signed(7)]
        )?,
        r#"[7000012,"biomeShop",3,[-4,5,6,7],null]"#
    );
    let outcome = ProposalJson::new(r#"{"offer":{"z":1,"a":2},"accepted":true}"#)?;
    assert_eq!(
        fingerprint_bargain(safe(12), &outcome)?,
        r#"[7500012,"bargain",{"offer":{"z":1,"a":2},"accepted":true}]"#
    );
    assert_eq!(
        fingerprint_bargain(SafeU53::MAX, &ProposalJson::new("null")?),
        Err(er_protocol::ProposalFingerprintError::SequenceOverflow)
    );
    assert_eq!(
        fingerprint_reward(safe(1), "", signed(0), None, None)?,
        r#"[1,"",0,null,null]"#
    );

    for seed in 0..12_u64 {
        let mut ledger = replay(
            seed,
            "proposal-ledger-init",
            ProposalAdmissionLedger::new(safe(3)),
        )?;
        for ordinal in 0..3_u64 {
            let proposal_operation = replay(
                seed,
                format!("proposal-operation-{ordinal}"),
                operation(&format!("proposal-{seed}-{ordinal}")),
            )?;
            let proposal = ProposalIdentity {
                operation_id: proposal_operation,
                fingerprint: format!("fingerprint-{}", (seed + ordinal) % 4),
            };
            assert_eq!(
                ledger.admit(&proposal),
                ProposalAdmission::Admitted,
                "seed={seed} operation={ordinal} admission"
            );
            assert_eq!(
                ledger.admit(&proposal),
                ProposalAdmission::Duplicate,
                "seed={seed} operation={ordinal} duplicate"
            );
            assert_eq!(
                ledger.fingerprint(&proposal.operation_id),
                Some(proposal.fingerprint.as_str()),
                "seed={seed} operation={ordinal} fingerprint"
            );
            let conflict = ProposalIdentity {
                operation_id: proposal.operation_id.clone(),
                fingerprint: format!("conflict-{seed}-{ordinal}"),
            };
            assert_eq!(
                ledger.admit(&conflict),
                ProposalAdmission::Conflict,
                "seed={seed} operation={ordinal} conflict"
            );
        }
        let full = ProposalIdentity {
            operation_id: replay(
                seed,
                "proposal-full-operation",
                operation(&format!("proposal-{seed}-full")),
            )?,
            fingerprint: "new".to_owned(),
        };
        assert_eq!(
            ledger.admit(&full),
            ProposalAdmission::CapacityExhausted,
            "seed={seed} operation=capacity capacity"
        );
        assert_eq!(
            ledger.len(),
            safe(3),
            "seed={seed} operation=capacity non-evicting capacity"
        );
        assert!(
            ledger
                .fingerprint(&replay(
                    seed,
                    "proposal-fingerprint-operation",
                    operation(&format!("proposal-{seed}-0"))
                )?)
                .is_some(),
            "seed={seed} operation=capacity retained original proposal"
        );
        let invalid = ProposalIdentity {
            operation_id: replay(
                seed,
                "proposal-invalid-operation",
                operation(&format!("proposal-{seed}-invalid")),
            )?,
            fingerprint: String::new(),
        };
        assert_eq!(
            ledger.admit(&invalid),
            ProposalAdmission::Invalid,
            "seed={seed} operation=invalid invalid proposal"
        );
        ledger.reset();
        assert!(ledger.is_empty(), "seed={seed} operation=reset reset");
        ledger.dispose();
        ledger.dispose();
        assert_eq!(
            ledger.admit(&full),
            ProposalAdmission::Invalid,
            "seed={seed} operation=disposed disposed admission"
        );
        assert!(
            ledger.diagnostics().fingerprints.is_empty(),
            "seed={seed} operation=disposed disposed ledger fingerprints"
        );
    }

    let config = ProposalLeaseConfig {
        owner_prefix: "authority-v2:proposal:".to_owned(),
        retry_initial_ms: safe(GOLDEN_PROPOSAL_RETRY_INITIAL_MS),
        retry_maximum_ms: safe(GOLDEN_PROPOSAL_RETRY_MAX_MS),
        absolute_ceiling_ms: safe(GOLDEN_PROPOSAL_ABSOLUTE_CEILING_MS),
    };
    let mut manager = ProposalLeaseManager::new(config.clone())?;
    let mut scheduler = KernelScheduler::new();
    let first = ProposalMessage {
        operation_id: operation("lease/first")?,
        fingerprint: "intent-a".to_owned(),
        from: seat(1),
        to: seat(2),
        connection_generation: generation(1),
        payload: Value::String("opaque".to_owned()),
    };
    let mut exhausted_scheduler = KernelScheduler::new();
    let _ = exhausted_scheduler.dispose();
    let mut rollback_manager = ProposalLeaseManager::new(config.clone())?;
    let failed_arm = rollback_manager.arm(
        ProposalLeaseSpec {
            proposal: first.clone(),
            absolute_ceiling_ms: Some(safe(GOLDEN_PROPOSAL_TEST_CEILING_MS)),
        },
        &mut exhausted_scheduler,
    );
    assert!(
        matches!(
            failed_arm,
            Err(er_protocol::ProposalLeaseError::Scheduler(
                SchedulerError::Disposed
            ))
        ),
        "seed=0 operation=proposal-capacity schedule failure"
    );
    assert_eq!(
        rollback_manager.retained_count(),
        SafeU53::ZERO,
        "seed=0 operation=proposal-capacity lease rollback"
    );
    assert!(
        rollback_manager.diagnostics().timer_ids.is_empty(),
        "seed=0 operation=proposal-capacity timer rollback"
    );
    let armed = manager.arm(
        ProposalLeaseSpec {
            proposal: first.clone(),
            absolute_ceiling_ms: Some(safe(GOLDEN_PROPOSAL_TEST_CEILING_MS)),
        },
        &mut scheduler,
    )?;
    assert_eq!(armed.result, ProposalLeaseStart::Retained);
    assert_proposal_arm_actions(&armed.actions, &first, 0, "proposal-arm");
    let timer_ids = armed
        .actions
        .iter()
        .filter_map(|action| match action {
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            } => Some(timer.timer_id),
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        timer_ids,
        BTreeSet::from([TimerId::new(safe(0)), TimerId::new(safe(1))]),
        "seed=0 operation=proposal-arm exact scheduled timer ids"
    );
    assert_eq!(manager.retained_count(), safe(1));
    let refreshed = manager.arm(
        ProposalLeaseSpec {
            proposal: first.clone(),
            absolute_ceiling_ms: Some(safe(GOLDEN_PROPOSAL_TEST_CEILING_MS)),
        },
        &mut scheduler,
    )?;
    assert_eq!(refreshed.result, ProposalLeaseStart::AlreadyRetained);
    assert_eq!(
        refreshed.actions,
        vec![ProposalLeaseAction::Send {
            proposal: first.clone()
        }],
        "seed=0 operation=proposal-refresh exact resend"
    );
    assert_eq!(
        manager.diagnostics().timer_ids,
        BTreeSet::from([TimerId::new(safe(0)), TimerId::new(safe(1))]),
        "seed=0 operation=proposal-refresh same-sender rearm retains both scheduler registrations"
    );
    assert_eq!(
        scheduler.live_timers().len(),
        2,
        "seed=0 operation=proposal-refresh same-sender rearm does not duplicate registrations"
    );
    let sender_changed = ProposalMessage {
        from: seat(9),
        ..first.clone()
    };
    let before_sender_change = manager.diagnostics();
    let before_sender_change_scheduler = scheduler_snapshot(&scheduler);
    let sender_change = manager.arm(
        ProposalLeaseSpec {
            proposal: sender_changed,
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    assert_eq!(
        sender_change.result,
        ProposalLeaseStart::Invalid,
        "seed=0 operation=proposal-refresh sender change rejected"
    );
    assert!(
        sender_change.actions.is_empty(),
        "seed=0 operation=proposal-refresh sender change has no actions"
    );
    assert_eq!(
        manager.diagnostics(),
        before_sender_change,
        "seed=0 operation=proposal-refresh sender change is fail-atomic"
    );
    assert_eq!(
        scheduler_snapshot(&scheduler),
        before_sender_change_scheduler,
        "seed=0 operation=proposal-refresh sender change preserves scheduler resources"
    );
    let conflict = ProposalMessage {
        fingerprint: "different".to_owned(),
        ..first.clone()
    };
    assert_eq!(
        manager
            .arm(
                ProposalLeaseSpec {
                    proposal: conflict,
                    absolute_ceiling_ms: None,
                },
                &mut scheduler,
            )?
            .result,
        ProposalLeaseStart::Conflict
    );
    assert_eq!(manager.resend_retained().0, safe(1));
    let rebound_first = ProposalMessage {
        connection_generation: generation(2),
        ..first.clone()
    };
    let rebound = manager.rebind(seat(2), generation(2))?;
    assert_eq!(rebound.0, safe(1));
    assert_eq!(
        rebound.1,
        vec![ProposalLeaseAction::Send {
            proposal: rebound_first.clone()
        }],
        "seed=0 operation=proposal-rebind exact resend"
    );
    let stale_rebind = manager.rebind(seat(2), generation(1))?;
    assert_eq!(
        stale_rebind.0,
        SafeU53::ZERO,
        "seed=0 operation=proposal-rebind stale generation is idempotent"
    );
    assert!(
        stale_rebind.1.is_empty(),
        "seed=0 operation=proposal-rebind stale generation has no resend"
    );
    let mut retry_timer = match armed.actions.get(1) {
        Some(ProposalLeaseAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        }) => timer.to_owned(),
        other => {
            return Err(missing(format!(
                "seed=0 operation=proposal-retry-0 retry schedule index was {other:?}"
            )));
        }
    };
    let removed_retry = fire_exact_timer(&mut scheduler, &retry_timer, 0, 0)?;
    let mut malformed_retry = removed_retry.clone();
    malformed_retry.owner.reason = "stale-generation/timer".to_owned();
    let before_malformed_retry = manager.diagnostics();
    let before_malformed_retry_scheduler = scheduler_snapshot(&scheduler);
    assert!(
        manager
            .timer_fired(malformed_retry, &mut scheduler)
            .is_err(),
        "seed=0 operation=0 malformed proposal timer rejected"
    );
    assert_eq!(
        manager.diagnostics(),
        before_malformed_retry,
        "seed=0 operation=0 malformed proposal timer preserves lease"
    );
    assert_eq!(
        scheduler_snapshot(&scheduler),
        before_malformed_retry_scheduler,
        "seed=0 operation=0 malformed proposal timer preserves complete scheduler resources"
    );
    let first_retry = manager.timer_fired(removed_retry, &mut scheduler)?;
    assert_eq!(
        first_retry.len(),
        2,
        "seed=0 operation=1 retry schedule precedes send"
    );
    match &first_retry[1] {
        ProposalLeaseAction::Send { proposal } => assert_eq!(
            proposal, &rebound_first,
            "seed=0 operation=1 initial retry send"
        ),
        other => panic!("seed=0 operation=1 retry send index was {other:?}"),
    }
    let first_retry_timer = match &first_retry[0] {
        ProposalLeaseAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        } => timer,
        other => panic!("seed=0 operation=1 retry schedule index was {other:?}"),
    };
    assert_eq!(
        first_retry_timer.timer_id,
        TimerId::new(safe(2)),
        "seed=0 operation=1 retry timer id"
    );
    assert_eq!(
        first_retry_timer.endpoint, first.from,
        "seed=0 operation=1 retry endpoint"
    );
    assert_eq!(
        first_retry_timer.owner,
        timer_owner(
            "authority-v2:proposal:lease/first",
            "lease/first",
            "v2 proposal retry"
        ),
        "seed=0 operation=1 retry owner"
    );
    assert_eq!(
        first_retry_timer.time_class,
        TimeClass::Connected,
        "seed=0 operation=1 retry class"
    );
    retry_timer = first_retry_timer.to_owned();
    assert_eq!(
        retry_timer.delay_ms,
        safe(500),
        "seed=0 operation=1 retry delay"
    );
    for (operation, expected_delay) in [1_000_u64, 2_000, 4_000, 5_000].into_iter().enumerate() {
        let operation = operation + 2;
        let fired = fire_exact_timer(&mut scheduler, &retry_timer, 0, operation)?;
        let retry = manager.timer_fired(fired, &mut scheduler)?;
        assert_eq!(
            retry.len(),
            2,
            "seed=0 operation={operation} retry schedule precedes send"
        );
        match &retry[1] {
            ProposalLeaseAction::Send { proposal } => assert_eq!(
                proposal, &rebound_first,
                "seed=0 operation={operation} retry send at {expected_delay}ms"
            ),
            other => panic!("seed=0 operation={operation} retry send index was {other:?}"),
        }
        let retry_schedule = match &retry[0] {
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Schedule { timer },
            } => timer,
            other => panic!("seed=0 operation={operation} retry schedule index was {other:?}"),
        };
        assert_eq!(
            retry_schedule.endpoint, first.from,
            "seed=0 operation={operation} retry endpoint"
        );
        assert_eq!(
            retry_schedule.owner,
            timer_owner(
                "authority-v2:proposal:lease/first",
                "lease/first",
                "v2 proposal retry"
            ),
            "seed=0 operation={operation} retry owner"
        );
        assert_eq!(
            retry_schedule.time_class,
            TimeClass::Connected,
            "seed=0 operation={operation} retry class"
        );
        retry_timer = retry_schedule.to_owned();
        assert_eq!(
            retry_timer.delay_ms,
            safe(expected_delay),
            "seed=0 operation={operation} retry delay"
        );
        assert_eq!(
            retry_timer.timer_id,
            TimerId::new(safe(operation as u64 + 1)),
            "seed=0 operation={operation} retry timer id"
        );
    }
    let absolute_timer = match armed.actions.first() {
        Some(ProposalLeaseAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        }) => timer.to_owned(),
        other => {
            return Err(missing(format!(
                "seed=0 operation=proposal-expiry absolute schedule index was {other:?}"
            )));
        }
    };
    let fired = fire_exact_timer(&mut scheduler, &absolute_timer, 0, 6)?;
    let expiry = manager.timer_fired(fired, &mut scheduler)?;
    assert_eq!(
        expiry,
        vec![
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Cancel {
                    endpoint: seat(1),
                    timer_id: TimerId::new(safe(6)),
                },
            },
            ProposalLeaseAction::Terminalize {
                operation_id: first.operation_id.clone(),
                reason: "v2 proposal absolute ceiling".to_owned(),
            },
        ],
        "seed=0 operation=6 absolute expiry cancels retry before terminal"
    );
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert!(manager.diagnostics().timer_ids.is_empty());
    assert!(
        scheduler.live_timers().is_empty(),
        "seed=0 operation=7 expiry cancels retry"
    );
    manager.dispose("seed teardown", &mut scheduler);
    manager.dispose("duplicate", &mut scheduler);
    assert!(
        manager.diagnostics().disposed,
        "seed=0 operation=8 proposal disposal"
    );

    let mut active_disposal = ProposalLeaseManager::new(config.clone())?;
    let mut active_disposal_scheduler = KernelScheduler::new();
    let active_proposal = ProposalMessage {
        operation_id: operation("lease/active-disposal")?,
        ..first.clone()
    };
    let active_arm = active_disposal.arm(
        ProposalLeaseSpec {
            proposal: active_proposal.clone(),
            absolute_ceiling_ms: Some(safe(GOLDEN_PROPOSAL_TEST_CEILING_MS)),
        },
        &mut active_disposal_scheduler,
    )?;
    assert_eq!(
        active_arm.result,
        ProposalLeaseStart::Retained,
        "seed=0 operation=active-disposal retained"
    );
    let active_actions = active_disposal.dispose("active disposal", &mut active_disposal_scheduler);
    assert_eq!(
        active_actions,
        vec![
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Cancel {
                    endpoint: seat(1),
                    timer_id: TimerId::new(safe(0)),
                },
            },
            ProposalLeaseAction::Scheduler {
                command: SchedulerCommand::Cancel {
                    endpoint: seat(1),
                    timer_id: TimerId::new(safe(1)),
                },
            },
        ],
        "seed=0 operation=active-disposal exact terminal cancellations"
    );
    assert_eq!(
        active_disposal.retained_count(),
        SafeU53::ZERO,
        "seed=0 operation=active-disposal retained zero"
    );
    assert!(
        active_disposal.diagnostics().timer_ids.is_empty(),
        "seed=0 operation=active-disposal timer diagnostics zero"
    );
    assert!(
        active_disposal_scheduler.live_timers().is_empty(),
        "seed=0 operation=active-disposal scheduler resources zero"
    );
    assert!(
        active_disposal
            .dispose("duplicate", &mut active_disposal_scheduler)
            .is_empty(),
        "seed=0 operation=active-disposal idempotent"
    );

    let mut tombstones = ProposalLeaseManager::new(config)?;
    let committed = operation("lease/committed")?;
    assert_eq!(
        tombstones.observe_committed(&committed, &mut scheduler),
        (false, Vec::new())
    );
    let committed_proposal = ProposalMessage {
        operation_id: committed.clone(),
        ..first.clone()
    };
    assert_eq!(
        tombstones
            .arm(
                ProposalLeaseSpec {
                    proposal: committed_proposal,
                    absolute_ceiling_ms: None,
                },
                &mut scheduler,
            )?
            .result,
        ProposalLeaseStart::AlreadyCommitted
    );
    let live = ProposalMessage {
        operation_id: operation("lease/live")?,
        ..first
    };
    assert_eq!(
        tombstones
            .arm(
                ProposalLeaseSpec {
                    proposal: live.clone(),
                    absolute_ceiling_ms: None,
                },
                &mut scheduler,
            )?
            .result,
        ProposalLeaseStart::Retained
    );
    let settled = tombstones.observe_committed(&live.operation_id, &mut scheduler);
    assert!(settled.0);
    assert_eq!(tombstones.retained_count(), SafeU53::ZERO);
    assert!(
        scheduler.live_timers().is_empty(),
        "seed=0 operation=10 committed observation cancels timers"
    );
    assert_eq!(
        tombstones.observe_committed(&live.operation_id, &mut scheduler),
        (false, Vec::new()),
        "seed=0 operation=11 committed proposal identity executes once"
    );
    assert_eq!(
        tombstones
            .arm(
                ProposalLeaseSpec {
                    proposal: live,
                    absolute_ceiling_ms: None,
                },
                &mut scheduler,
            )?
            .result,
        ProposalLeaseStart::AlreadyCommitted
    );
    tombstones.dispose("property teardown", &mut scheduler);
    tombstones.dispose("duplicate", &mut scheduler);
    assert!(tombstones.diagnostics().committed_tombstones.is_empty());
    assert!(scheduler.live_timers().is_empty());
    Ok(())
}

fn context_value() -> Value {
    json!({
        "sessionId": "session-1",
        "runId": "run-1",
        "sessionEpoch": 3,
        "seatMapId": "seat-map-1",
        "membershipRevision": 2,
        "senderSeatId": 1,
        "authoritySeatId": 0,
        "connectionGeneration": 2
    })
}

fn raw_envelope(frame_type: &str, body: Value) -> Value {
    json!({"v": 2, "t": frame_type, "ctx": context_value(), "body": body})
}

fn valid_material_value() -> Value {
    json!({"digest": "digest", "payload": null})
}

fn command_control_value() -> Value {
    json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": 3,
        "wave": 4,
        "turn": 1,
        "commands": [{"ownerSeatId": 0, "pokemonId": 7, "fieldIndex": 0}]
    })
}

fn valid_entry_body() -> Value {
    json!({
        "revision": 1,
        "operationId": "operation-1",
        "kind": "TURN_COMMIT",
        "material": valid_material_value(),
        "nextControl": command_control_value(),
        "subsumes": []
    })
}

fn known_frame_cases() -> [(&'static str, Value); 8] {
    [
        ("authorityEntry", valid_entry_body()),
        (
            "authorityReceipt",
            json!({"revision": 0, "operationId": "operation-1", "stage": "admitted"}),
        ),
        ("tailRequest", json!({"fromRevision": 0})),
        (
            "tailProof",
            json!({
                "phase": "manifest",
                "requestId": "request-1",
                "fromRevision": 0,
                "candidateRevision": 2,
                "candidateOperationId": "candidate-1",
                "headRevision": 2,
                "sourceRevisions": [1]
            }),
        ),
        (
            "recoveryRequest",
            json!({"requestId": "request-1", "capturedFrontier": 0, "reason": "rejoin"}),
        ),
        (
            "recoveryBundle",
            json!({
                "requestId": "request-1",
                "material": valid_material_value(),
                "frontier": 0,
                "frontierOperationId": null,
                "membershipRevision": 2,
                "nextControl": null,
                "requiredTail": []
            }),
        ),
        (
            "recoveryApplied",
            json!({"requestId": "request-1", "frontier": 0, "materialDigest": "digest"}),
        ),
        (
            "terminal",
            json!({"terminalId": "terminal-1", "reason": "protocol"}),
        ),
    ]
}

#[derive(Debug)]
enum RawCaseExpectation {
    ValidTailRequest {
        from_revision: u64,
    },
    Violation {
        frame_type: Option<&'static str>,
        issues: Vec<&'static str>,
    },
}

fn malformed_raw_cases() -> Vec<(String, RawCaseExpectation)> {
    let context = serde_json::to_string(&context_value())
        .expect("static context fixture must serialize deterministically");
    let malformed_context = |field: &str, value: Value| {
        let mut context = context_value();
        context
            .as_object_mut()
            .expect("static context fixture must be an object")
            .insert(field.to_owned(), value);
        format!(
            r#"{{"v":2,"t":"tailRequest","ctx":{},"body":{{"fromRevision":0}}}}"#,
            serde_json::to_string(&context)
                .expect("static malformed context fixture must serialize deterministically")
        )
    };
    let nested_tail_revision = r#"{"revision":1e400,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1,"wave":1,"turn":1,"commands":[{"ownerSeatId":0,"pokemonId":1,"fieldIndex":0}]},"subsumes":[]}"#;
    let nested_control_epoch = r#"{"revision":1,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1e400,"wave":1,"turn":1,"commands":[{"ownerSeatId":0,"pokemonId":1,"fieldIndex":0}]},"subsumes":[]}"#;
    vec![
        (
            format!(
                r#"{{"v":1,"v":2,"t":"tailRequest","ctx":{context},"body":{{"fromRevision":1,"fromRevision":0}}}}"#
            ),
            RawCaseExpectation::ValidTailRequest { from_revision: 0 },
        ),
        (
            format!(
                r#"{{"v":2,"t":"tailRequest","ctx":{context},"body":{{"fromRevision":0,"fromRevision":1e400}}}}"#
            ),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["body.fromRevision"],
            },
        ),
        (
            r#"{"v":2,"t":"terminal","ctx":{"sessionId":"\uD800","runId":"run-1","sessionEpoch":3,"seatMapId":"seat-map-1","membershipRevision":2,"senderSeatId":1,"authoritySeatId":0,"connectionGeneration":2},"body":{"terminalId":"terminal-1","reason":"protocol"}}"#.to_owned(),
            RawCaseExpectation::Violation {
                frame_type: None,
                issues: vec!["malformed JSON"],
            },
        ),
        (
            format!(
                r#"{{"v":2,"t":"recoveryBundle","ctx":{context},"body":{{"requestId":"request","material":{{"digest":"digest","payload":null}},"frontier":0,"frontierOperationId":null,"membershipRevision":2,"nextControl":null,"requiredTail":[{nested_tail_revision}]}}}}"#
            ),
            RawCaseExpectation::Violation {
                frame_type: Some("recoveryBundle"),
                issues: vec!["body.requiredTail[0].revision"],
            },
        ),
        (
            format!(
                r#"{{"v":2,"t":"recoveryBundle","ctx":{context},"body":{{"requestId":"request","material":{{"digest":"digest","payload":null}},"frontier":0,"frontierOperationId":null,"membershipRevision":2,"nextControl":null,"requiredTail":[{nested_control_epoch}]}}}}"#
            ),
            RawCaseExpectation::Violation {
                frame_type: Some("recoveryBundle"),
                issues: vec!["body.requiredTail[0].nextControl.epoch"],
            },
        ),
        (
            format!(r#"{{"v":2,"t":"tailRequest","ctx":{context},"body":null}}"#),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["body.not an object"],
            },
        ),
        (
            malformed_context("sessionId", Value::Null),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.sessionId"],
            },
        ),
        (
            malformed_context("runId", json!(17)),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.runId"],
            },
        ),
        (
            malformed_context("sessionEpoch", json!("3")),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.sessionEpoch"],
            },
        ),
        (
            malformed_context("seatMapId", Value::Null),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.seatMapId"],
            },
        ),
        (
            malformed_context("membershipRevision", json!("2")),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.membershipRevision"],
            },
        ),
        (
            malformed_context("senderSeatId", json!(-1)),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.senderSeatId"],
            },
        ),
        (
            malformed_context("authoritySeatId", json!("0")),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.authoritySeatId"],
            },
        ),
        (
            malformed_context("connectionGeneration", json!(1.5)),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.connectionGeneration"],
            },
        ),
        (
            r#"{"v":2,"t":"tailRequest","body":{"fromRevision":0}}"#.to_owned(),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["ctx.frame context is not an object"],
            },
        ),
        (
            format!(r#"{{"v":2,"t":"tailRequest","ctx":{context},"body":{{"fromRevision":"0"}}}}"#),
            RawCaseExpectation::Violation {
                frame_type: Some("tailRequest"),
                issues: vec!["body.fromRevision"],
            },
        ),
        (
            format!(
                r#"{{"v":2,"t":"recoveryBundle","ctx":{context},"body":{{"requestId":"request","material":{{"digest":"digest","payload":null}},"frontier":0,"membershipRevision":2,"requiredTail":[]}}}}"#
            ),
            RawCaseExpectation::Violation {
                frame_type: Some("recoveryBundle"),
                issues: vec![
                    "body.frontierOperationId",
                    "body.nextControl: must be null at frontier zero",
                ],
            },
        ),
    ]
}

#[test]
fn raw_frame_seeded_generator_is_total_and_preserves_precedence() -> TestResult {
    for seed in 0..20_u64 {
        let mut rng = DeterministicRng::new(seed ^ 0xA5A5_5A5A);
        for step in 0..96_usize {
            let value = if step % 11 == 0 {
                json!({"v": 2, "t": "authorityReceipt", "ctx": {}, "body": null})
            } else {
                generated_json(&mut rng, 0)
            };
            let raw = if step % 13 == 0 {
                RawFrame::JsonText("{\"v\":2,\"t\":\"authorityEntry\"".to_owned())
            } else if step % 2 == 0 {
                RawFrame::JsonValue(value)
            } else {
                RawFrame::JsonText(replay(
                    seed,
                    format!("raw-json-{step}"),
                    serde_json::to_string(&value),
                )?)
            };
            let result =
                catch_unwind(AssertUnwindSafe(|| validate_inbound_frame(&raw))).map_err(|_| {
                    missing(format!(
                        "seed={seed} operation={step} validator panicked for {raw:?}"
                    ))
                })?;
            match result {
                InboundFrameResult::Valid { frame } => {
                    assert!(
                        matches!(
                            frame.frame.frame_type,
                            FrameType::AuthorityEntry
                                | FrameType::AuthorityReceipt
                                | FrameType::TailRequest
                                | FrameType::TailProof
                                | FrameType::RecoveryRequest
                                | FrameType::RecoveryBundle
                                | FrameType::RecoveryApplied
                                | FrameType::Terminal
                        ),
                        "seed={seed} operation={step} invalid valid frame tag"
                    );
                }
                InboundFrameResult::CosmeticDrop { reason } => assert!(
                    !reason.is_empty(),
                    "seed={seed} operation={step} empty cosmetic reason"
                ),
                InboundFrameResult::ProtocolViolation { issues, .. } => assert!(
                    !issues.is_empty(),
                    "seed={seed} operation={step} empty protocol issue list"
                ),
            }
        }
    }

    for (operation, (raw, expectation)) in malformed_raw_cases().into_iter().enumerate() {
        let result = catch_unwind(AssertUnwindSafe(|| {
            validate_inbound_frame(&RawFrame::JsonText(raw.clone()))
        }))
        .map_err(|_| {
            missing(format!(
                "seed=20 operation={operation} malformed raw case panicked: {raw}"
            ))
        })?;
        match expectation {
            RawCaseExpectation::ValidTailRequest { from_revision } => match result {
                InboundFrameResult::Valid { frame } => match &frame.body {
                    ValidatedFrameBody::TailRequest(body) => assert_eq!(
                        body.from_revision.get().get(),
                        from_revision,
                        "seed=20 operation={operation} duplicate-key last value"
                    ),
                    other => {
                        panic!("seed=20 operation={operation} duplicate-key body was {other:?}")
                    }
                },
                other => panic!(
                    "seed=20 operation={operation} duplicate-key valid case classified as {other:?}"
                ),
            },
            RawCaseExpectation::Violation { frame_type, issues } => match result {
                InboundFrameResult::ProtocolViolation {
                    frame_type: actual_frame_type,
                    issues: actual_issues,
                } => {
                    assert_eq!(
                        actual_frame_type.as_deref(),
                        frame_type,
                        "seed=20 operation={operation} malformed frame classification"
                    );
                    assert_eq!(
                        actual_issues,
                        issues.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                        "seed=20 operation={operation} malformed issue paths"
                    );
                }
                other => {
                    panic!("seed=20 operation={operation} malformed case classified as {other:?}")
                }
            },
        }
    }

    let mut identity_log = authority_log(2, &[(1, 4)])?;
    let mut identity_scheduler = KernelScheduler::new();
    let identity_authority = authority_context()?;
    let identity_entry = identity_log
        .commit(
            draft(
                &identity_authority,
                "identity-operation",
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            )?,
            &mut identity_scheduler,
        )?
        .entry;
    let identity_receipt = receipt_for(&identity_entry, 1, 4, AckStage::Admitted, None)?;
    let mut identity_cases = Vec::new();
    let mut changed = identity_receipt.clone();
    changed.context.session_id = session("other-session")?;
    identity_cases.push(("session", changed, ReceiptRejectReason::SessionMismatch));
    let mut changed = identity_receipt.clone();
    changed.context.run_id = run("other-run")?;
    identity_cases.push(("run", changed, ReceiptRejectReason::SessionMismatch));
    let mut changed = identity_receipt.clone();
    changed.context.session_epoch = safe(4);
    identity_cases.push(("epoch", changed, ReceiptRejectReason::StaleEpoch));
    let mut changed = identity_receipt.clone();
    changed.context.seat_map_id = "other-seat-map".to_owned();
    identity_cases.push(("seat-map", changed, ReceiptRejectReason::SessionMismatch));
    let mut changed = identity_receipt.clone();
    changed.context.membership_revision = MembershipRevision::new(safe(3));
    identity_cases.push((
        "membership",
        changed,
        ReceiptRejectReason::MembershipMismatch,
    ));
    let mut changed = identity_receipt.clone();
    changed.context.sender_seat_id = seat(2);
    identity_cases.push(("sender", changed, ReceiptRejectReason::UnboundPeer));
    let mut changed = identity_receipt.clone();
    changed.context.authority_seat_id = seat(9);
    identity_cases.push(("authority", changed, ReceiptRejectReason::AuthorityMismatch));
    let mut changed = identity_receipt;
    changed.context.connection_generation = generation(3);
    identity_cases.push((
        "generation",
        changed,
        ReceiptRejectReason::ConnectionGenerationMismatch,
    ));
    for (operation, receipt, expected_reason) in identity_cases {
        let before_diagnostics = identity_log.diagnostics();
        let before_timers = identity_scheduler.live_timers();
        let outcome = identity_log.accept_receipt_detailed(receipt, &mut identity_scheduler);
        assert_eq!(
            outcome.verdict,
            AuthorityReceiptVerdict::Rejected {
                reason: expected_reason,
            },
            "seed=21 operation={operation} identity reject classification"
        );
        assert!(
            outcome.actions.is_empty(),
            "seed=21 operation={operation} identity reject actions"
        );
        assert_eq!(
            identity_log.diagnostics(),
            before_diagnostics,
            "seed=21 operation={operation} identity reject fail-atomic diagnostics"
        );
        assert_eq!(
            identity_scheduler.live_timers(),
            before_timers,
            "seed=21 operation={operation} identity reject fail-atomic timers"
        );
    }
    identity_log.dispose("identity matrix teardown", &mut identity_scheduler);
    assert!(
        identity_log.diagnostics().disposed,
        "seed=21 operation=identity-cleanup disposed log"
    );
    assert!(
        identity_log.retained().is_empty(),
        "seed=21 operation=identity-cleanup retained entries"
    );
    assert!(
        identity_scheduler.live_timers().is_empty(),
        "seed=21 operation=identity-cleanup scheduler resources"
    );

    let left = context(1, 0, 2, 2, 3)?;
    let mut context_axes = Vec::new();
    let mut changed = left.clone();
    changed.session_id = session("other-session")?;
    context_axes.push(("session", changed, false));
    let mut changed = left.clone();
    changed.run_id = run("other-run")?;
    context_axes.push(("run", changed, false));
    let mut changed = left.clone();
    changed.session_epoch = safe(4);
    context_axes.push(("epoch", changed, false));
    let mut changed = left.clone();
    changed.seat_map_id = "other-seat-map".to_owned();
    context_axes.push(("seat-map", changed, false));
    let mut changed = left.clone();
    changed.membership_revision = MembershipRevision::new(safe(3));
    context_axes.push(("membership", changed, false));
    let mut changed = left.clone();
    changed.sender_seat_id = seat(0);
    context_axes.push(("sender", changed, true));
    let mut changed = left.clone();
    changed.authority_seat_id = seat(9);
    context_axes.push(("authority", changed, true));
    let mut changed = left;
    changed.connection_generation = generation(4);
    context_axes.push(("generation", changed, true));
    let base_context = context(1, 0, 2, 2, 3)?;
    for (operation, right, compatible) in context_axes {
        assert!(
            !frame_contexts_equal(&base_context, &right),
            "seed=22 operation={operation} identity equality axis"
        );
        assert_eq!(
            frame_contexts_compatible(&base_context, &right),
            compatible,
            "seed=22 operation={operation} compatibility axis"
        );
    }

    let malformed =
        validate_inbound_frame(&RawFrame::JsonText("{\"v\":2,\"t\":\"unknown\"".to_owned()));
    assert!(
        matches!(malformed, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["malformed JSON"])
    );
    let non_object = validate_inbound_frame(&RawFrame::JsonValue(json!([])));
    assert!(
        matches!(non_object, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["frame is not a JSON object"])
    );
    let version_precedence =
        validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 1, "t": "futureCosmetic"})));
    assert!(
        matches!(version_precedence, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["unsupported frame protocol version: 1"])
    );
    let missing_version =
        validate_inbound_frame(&RawFrame::JsonValue(json!({"t": 17, "body": null})));
    assert!(
        matches!(missing_version, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["missing protocol version `v`"])
    );
    let missing_type = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 2, "body": null})));
    assert!(
        matches!(missing_type, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["frame type `t` is missing or not a string"])
    );
    let non_string_type = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 2, "t": {}})));
    assert!(
        matches!(non_string_type, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["frame type `t` is missing or not a string"])
    );
    let raw_version_precedence =
        validate_inbound_frame(&RawFrame::JsonValue(json!({"v": "2", "t": "terminal"})));
    assert!(
        matches!(raw_version_precedence, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["unsupported frame protocol version: 2"])
    );
    let cosmetic = validate_inbound_frame(&RawFrame::JsonValue(
        json!({"v": 2, "t": "futureCosmetic", "ctx": null, "body": null}),
    ));
    assert!(
        matches!(cosmetic, InboundFrameResult::CosmeticDrop { reason } if reason == "unknown cosmetic frame type: futureCosmetic")
    );
    let known_malformed = validate_inbound_frame(&RawFrame::JsonValue(json!({
        "v": 2,
        "t": "tailRequest",
        "ctx": {},
        "body": null
    })));
    assert!(
        matches!(known_malformed, InboundFrameResult::ProtocolViolation { frame_type: Some(frame_type), issues } if frame_type == "tailRequest" && issues == vec![
        "ctx.sessionId", "ctx.runId", "ctx.sessionEpoch", "ctx.seatMapId", "ctx.membershipRevision", "ctx.senderSeatId", "ctx.authoritySeatId", "ctx.connectionGeneration", "body.not an object"
    ].into_iter().map(str::to_owned).collect::<Vec<_>>())
    );

    for (frame_type, body) in known_frame_cases() {
        let result = FrameValidator::new()
            .validate(&RawFrame::JsonValue(raw_envelope(frame_type, body.clone())));
        assert!(
            matches!(result, InboundFrameResult::Valid { .. }),
            "known frame {frame_type} did not validate"
        );
    }
    let mut known_nested_unknown = raw_envelope(
        "tailRequest",
        json!({
            "fromRevision": 0,
            "futureExtension": {"nested": {"property": "accepted"}}
        }),
    );
    if let Some(context) = known_nested_unknown
        .as_object_mut()
        .and_then(|frame| frame.get_mut("ctx"))
        .and_then(Value::as_object_mut)
    {
        context.insert(
            "futureContextExtension".to_owned(),
            json!({"nested": {"property": [1, 2, 3]}}),
        );
    }
    assert!(
        matches!(
            validate_inbound_frame(&RawFrame::JsonValue(known_nested_unknown)),
            InboundFrameResult::Valid { .. }
        ),
        "seed=20 operation=known-nested-unknown known-frame extension object is accepted"
    );
    let nested_invalid_number = r#"{"v":2,"t":"recoveryBundle","ctx":{"sessionId":"session-1","runId":"run-1","sessionEpoch":3,"seatMapId":"seat-map-1","membershipRevision":2,"senderSeatId":1,"authoritySeatId":0,"connectionGeneration":2},"body":{"requestId":"request","material":{"digest":"digest","payload":null},"frontier":0,"frontierOperationId":null,"membershipRevision":2,"nextControl":null,"requiredTail":[{"revision":1e400,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1,"wave":1,"turn":1,"commands":[{"ownerSeatId":0,"pokemonId":1,"fieldIndex":0}]},"subsumes":[]}]}}"#;
    assert!(
        matches!(
            validate_inbound_frame(&RawFrame::JsonText(nested_invalid_number.to_owned())),
            InboundFrameResult::ProtocolViolation {
                frame_type: Some(frame_type),
                issues
            } if frame_type == "recoveryBundle" && issues == vec!["body.requiredTail[0].revision"]
        ),
        "seed=20 operation=known-nested-number known-frame nested number remains invalid"
    );
    let mut missing_context = context_value();
    if let Some(object) = missing_context.as_object_mut() {
        object.remove("sessionId");
        object.remove("connectionGeneration");
    }
    let issues = frame_context_issues(&missing_context);
    assert_eq!(
        issues,
        vec!["sessionId".to_owned(), "connectionGeneration".to_owned()]
    );
    let left: FrameContext = serde_json::from_value(context_value())?;
    let mut peer_value = context_value();
    if let Some(object) = peer_value.as_object_mut() {
        object.insert("senderSeatId".to_owned(), json!(0));
        object.insert("connectionGeneration".to_owned(), json!(3));
    }
    let peer: FrameContext = serde_json::from_value(peer_value)?;
    assert!(!frame_contexts_equal(&left, &peer));
    assert!(frame_contexts_compatible(&left, &peer));
    Ok(())
}

#[test]
fn shared_boundary_cases_cover_safe_numbers_utf16_tokens_nullability_and_max_ids() -> TestResult {
    let accepted_numbers = [
        ("0", 0_u64),
        ("-0", 0),
        ("0.0", 0),
        ("-0.0", 0),
        ("0e0", 0),
        ("1.0", 1),
        ("1e0", 1),
        ("1e-400", 0),
        ("-1e-400", 0),
        ("9007199254740990.5", SafeU53::MAX.get() - 1),
        ("9007199254740991.1", SafeU53::MAX.get()),
        ("9007199254740991", SafeU53::MAX.get()),
        ("9007199254740991.0", SafeU53::MAX.get()),
        ("9.007199254740991e15", SafeU53::MAX.get()),
    ];
    for (operation, (wire_number, expected)) in accepted_numbers.into_iter().enumerate() {
        let raw = format!(
            r#"{{"v":2,"t":"tailRequest","ctx":{},"body":{{"fromRevision":{wire_number}}}}}"#,
            serde_json::to_string(&context_value())?
        );
        let result = validate_inbound_frame(&RawFrame::JsonText(raw));
        assert!(
            matches!(result, InboundFrameResult::Valid { .. }),
            "seed=0 operation={operation} accepted SafeU53 number {wire_number}"
        );
        let parsed: SafeU53 = serde_json::from_str(wire_number)?;
        assert_eq!(
            parsed.get(),
            expected,
            "seed=0 operation={operation} SafeU53 decoded value"
        );
    }

    for (operation, wire_number) in [
        (10_usize, "1.5"),
        (11, "-1"),
        (12, "9007199254740992"),
        (13, "1e400"),
    ] {
        let raw = format!(
            r#"{{"v":2,"t":"tailRequest","ctx":{},"body":{{"fromRevision":{wire_number}}}}}"#,
            serde_json::to_string(&context_value())?
        );
        assert!(
            matches!(
                validate_inbound_frame(&RawFrame::JsonText(raw)),
                InboundFrameResult::ProtocolViolation { .. }
            ),
            "seed=0 operation={operation} rejected SafeU53 number {wire_number}"
        );
        assert!(
            serde_json::from_str::<SafeU53>(wire_number).is_err(),
            "seed=0 operation={operation} SafeU53 rejected {wire_number}"
        );
    }

    for (operation, (wire_number, expected)) in [
        ("-1.0", -1_i64),
        ("-1e0", -1),
        ("-1e-400", 0),
        ("-0", 0),
        ("-0.0", 0),
        ("0e0", 0),
        ("1.0", 1),
        ("1e0", 1),
        ("1e-400", 0),
        ("9007199254740990.5", SafeI53::MAX.get() - 1),
        ("9007199254740991.1", SafeI53::MAX.get()),
        ("9007199254740991.0", SafeI53::MAX.get()),
        ("9.007199254740991e15", SafeI53::MAX.get()),
        ("-9.007199254740991e15", SafeI53::MIN.get()),
        ("-9007199254740991", SafeI53::MIN.get()),
        ("-9007199254740991.0", SafeI53::MIN.get()),
        ("-9007199254740991.1", SafeI53::MIN.get()),
    ]
    .into_iter()
    .enumerate()
    {
        let parsed: SafeI53 = serde_json::from_str(wire_number)?;
        assert_eq!(
            parsed.get(),
            expected,
            "seed=0 operation={operation} SafeI53 decoded value"
        );
    }
    for (operation, wire_number) in [(20_usize, "1.5"), (21, "1e400")] {
        assert!(
            serde_json::from_str::<SafeI53>(wire_number).is_err(),
            "seed=0 operation={operation} SafeI53 rejected {wire_number}"
        );
    }

    let at_limit = "\u{1f642}".repeat(GOLDEN_AUTHORITY_STRING_UTF16_LIMIT / 2);
    let over_limit = "\u{1f642}".repeat((GOLDEN_AUTHORITY_STRING_UTF16_LIMIT / 2) + 1);
    assert!(
        validate_authority_operation_id(&at_limit).is_ok(),
        "seed=0 operation=20 operation token UTF-16 boundary"
    );
    assert!(
        validate_authority_material_digest(&at_limit).is_ok(),
        "seed=0 operation=20 digest UTF-16 boundary"
    );
    assert!(
        validate_authority_operation_id(&over_limit).is_err(),
        "seed=0 operation=21 overlong operation token"
    );
    assert!(
        validate_authority_material_digest(&over_limit).is_err(),
        "seed=0 operation=21 overlong material digest"
    );
    assert!(
        validate_authority_operation_id("a\u{0000}b").is_err(),
        "seed=0 operation=22 operation token control character"
    );
    assert!(
        validate_authority_material_digest("a\u{0000}b").is_ok(),
        "seed=0 operation=22 digest control character remains opaque"
    );

    let mut receipt_without_control_id = raw_envelope(
        "authorityReceipt",
        json!({"revision": 0, "operationId": "operation-1", "stage": "admitted"}),
    );
    assert!(matches!(
        validate_inbound_frame(&RawFrame::JsonValue(receipt_without_control_id.clone())),
        InboundFrameResult::Valid { .. }
    ));
    if let Some(body) = receipt_without_control_id
        .as_object_mut()
        .and_then(|frame| frame.get_mut("body"))
        .and_then(Value::as_object_mut)
    {
        body.insert("controlId".to_owned(), Value::Null);
    }
    assert!(
        matches!(
            validate_inbound_frame(&RawFrame::JsonValue(receipt_without_control_id)),
            InboundFrameResult::ProtocolViolation { .. }
        ),
        "seed=0 operation=23 null optional controlId is distinguished from absent"
    );

    let mut bundle_without_required_nulls = raw_envelope(
        "recoveryBundle",
        json!({
            "requestId": "request-1",
            "material": valid_material_value(),
            "frontier": 0,
            "membershipRevision": 2,
            "requiredTail": []
        }),
    );
    assert!(
        matches!(
            validate_inbound_frame(&RawFrame::JsonValue(bundle_without_required_nulls.clone())),
            InboundFrameResult::ProtocolViolation { .. }
        ),
        "seed=0 operation=24 absent required-nullable recovery fields rejected"
    );
    if let Some(body) = bundle_without_required_nulls
        .as_object_mut()
        .and_then(|frame| frame.get_mut("body"))
        .and_then(Value::as_object_mut)
    {
        body.insert("frontierOperationId".to_owned(), Value::Null);
        body.insert("nextControl".to_owned(), Value::Null);
    }
    assert!(matches!(
        validate_inbound_frame(&RawFrame::JsonValue(bundle_without_required_nulls)),
        InboundFrameResult::Valid { .. }
    ));

    let max = SafeU53::MAX;
    let max_control = json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": max,
        "wave": max,
        "turn": max,
        "commands": [{
            "ownerSeatId": max,
            "pokemonId": max,
            "fieldIndex": max
        }]
    });
    let mut max_entry = valid_entry_body();
    if let Some(body) = max_entry.as_object_mut() {
        body.insert("revision".to_owned(), json!(max));
        body.insert("nextControl".to_owned(), max_control.clone());
    }
    assert!(matches!(
        validate_inbound_frame(&RawFrame::JsonValue(raw_envelope(
            "authorityEntry",
            max_entry,
        ))),
        InboundFrameResult::Valid { .. }
    ));
    let max_typed = command_control(
        max.get(),
        max.get(),
        max.get(),
        vec![command_target(max.get(), max.get(), max.get())],
    );
    let max_id = control_id_of(&max_typed);
    assert_eq!(
        max_id, GOLDEN_MAX_CONTROL_ID,
        "seed=0 operation=25 maximum control coordinates retain exact ID"
    );

    let mut invalid_log = authority_log(2, &[(1, 4)])?;
    let mut invalid_scheduler = KernelScheduler::new();
    let authority = authority_context()?;
    let opaque_over_limit = operation(&over_limit)?;
    let mut overlong_operation = draft(
        &authority,
        "valid-operation-token",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
    )?;
    overlong_operation.operation_id = opaque_over_limit;
    assert!(
        matches!(
            invalid_log.commit(overlong_operation, &mut invalid_scheduler),
            Err(er_protocol::AuthorityLogError::InvalidEntry { .. })
        ),
        "seed=0 operation=26 Authority token boundary rejects overlong opaque OperationId"
    );
    assert_eq!(
        invalid_log.head_revision(),
        Revision::ZERO,
        "seed=0 operation=26 rejected Authority token does not advance revision"
    );
    assert!(
        invalid_scheduler.live_timers().is_empty(),
        "seed=0 operation=26 rejected Authority token allocates no timer"
    );
    let mut overlong_digest = draft(
        &authority,
        "valid-digest-operation",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
    )?;
    overlong_digest.material.digest = over_limit;
    assert!(
        matches!(
            invalid_log.commit(overlong_digest, &mut invalid_scheduler),
            Err(er_protocol::AuthorityLogError::InvalidEntry { .. })
        ),
        "seed=0 operation=27 Authority digest UTF-16 enforcement"
    );
    assert_eq!(invalid_log.head_revision(), Revision::ZERO);
    assert!(invalid_scheduler.live_timers().is_empty());
    Ok(())
}

#[test]
fn successor_identity_is_stable_for_canonical_sets_and_sensitive_to_ordered_tails() -> TestResult {
    let command_a = command_control(
        1,
        2,
        3,
        vec![command_target(1, 1, 202), command_target(0, 0, 101)],
    );
    let command_b = command_control(
        1,
        2,
        3,
        vec![command_target(0, 0, 101), command_target(1, 1, 202)],
    );
    assert_eq!(
        control_id_of(&command_a),
        "COMMAND_FRONTIER/e1/w2/t3/f0:s0:p101,f1:s1:p202"
    );
    assert_eq!(
        control_id_of(&command_b),
        "COMMAND_FRONTIER/e1/w2/t3/f0:s0:p101,f1:s1:p202"
    );
    assert!(controls_equal(Some(&command_a), Some(&command_b)));
    assert!(same_control_address(&command_a, &command_b));

    let replacement = replacement_control("replacement/e1/w2/t3/o0/f0")?;
    assert_eq!(
        control_id_of(&replacement),
        "REPLACEMENT/replacement%2Fe1%2Fw2%2Ft3%2Fo0%2Ff0/s0/e1/w2/t3/o0/f0/remaining:replacement%2Ftail%2F1:s1:e1:w2:t3:o1:f1,replacement%2Ftail%2F2:s0:e1:w2:t3:o2:f2"
    );
    let mut reversed = replacement.clone();
    if let NextControl::Replacement(control) = &mut reversed {
        control.remaining.reverse();
    }
    assert_eq!(
        control_id_of(&reversed),
        "REPLACEMENT/replacement%2Fe1%2Fw2%2Ft3%2Fo0%2Ff0/s0/e1/w2/t3/o0/f0/remaining:replacement%2Ftail%2F2:s0:e1:w2:t3:o2:f2,replacement%2Ftail%2F1:s1:e1:w2:t3:o1:f1"
    );

    let shared_a = shared_control("REWARD", Some(vec![operation("id/b")?, operation("id/a")?]))?;
    let shared_b = shared_control("REWARD", Some(vec![operation("id/a")?, operation("id/b")?]))?;
    assert_eq!(
        control_id_of(&shared_a),
        "SHARED_INTERACTION/op%3Areward/REWARD/interaction%2Fcurrent/s1/e1/w2/t3/results:REWARD,REWARD_PRESENT/resultIds:id%2Fa,id%2Fb"
    );
    assert_eq!(
        control_id_of(&shared_b),
        "SHARED_INTERACTION/op%3Areward/REWARD/interaction%2Fcurrent/s1/e1/w2/t3/results:REWARD,REWARD_PRESENT/resultIds:id%2Fa,id%2Fb"
    );
    let wildcard = shared_control("REWARD", None)?;
    assert_eq!(
        control_id_of(&wildcard),
        "SHARED_INTERACTION/op%3Areward/REWARD/interaction%2Fcurrent/s1/e1/w2/t3/results:REWARD,REWARD_PRESENT/resultIds:*"
    );

    let wait = await_control()?;
    assert_eq!(
        control_id_of(&wait),
        "AWAIT_SUCCESSOR/predecessor/e1/w2/t3/INTERACTION_COMMIT,CONTROL_COMMIT,WAVE_ADVANCE,TERMINAL_COMMIT/interactionAddresses:*/controlAddresses:*/nextWave:1/next:*"
    );
    let terminal = terminal_control("terminal/e1/w2");
    assert_eq!(control_id_of(&terminal), "TERMINAL/terminal%2Fe1%2Fw2");
    assert_eq!(control_owner_seat_id(&command_a), None);
    assert_eq!(control_owner_seat_ids(&terminal), BTreeSet::new());
    assert!(partition_control_for_seat(&command_a, seat(0)).is_some());
    assert!(partition_control_for_seat(&command_a, seat(1)).is_some());

    let invalid = json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": 0,
        "wave": 2,
        "turn": 3,
        "commands": [
            {"ownerSeatId": 0, "pokemonId": 7, "fieldIndex": 0},
            {"ownerSeatId": 1, "pokemonId": 8, "fieldIndex": 0}
        ]
    });
    let issues = next_control_issues(&invalid);
    assert_eq!(
        issues,
        vec![
            "epoch".to_owned(),
            "commands[1].fieldIndex: duplicate".to_owned(),
        ],
        "seed=0 operation=successor-invalid exact issue order"
    );
    assert!(!is_valid_next_control(&invalid));
    let encoded = serde_json::to_value(command_a.clone())?;
    assert!(validate_next_control(&encoded).is_ok());
    assert!(is_valid_next_control(&encoded));
    assert_eq!(
        SuccessorValidator::new().validate(&encoded),
        Ok(command_a.clone())
    );

    let command_entry = authority_entry(
        &authority_context()?,
        1,
        "turn/accepted",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "wave": 2, "turn": 3}),
        command_a.clone(),
    )?;
    assert!(control_allows_successor_entry(
        &command_a,
        &operation("predecessor")?,
        &command_entry
    ));
    let stale_entry = authority_entry(
        &authority_context()?,
        2,
        "turn/stale",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "wave": 2, "turn": 4}),
        command_a.clone(),
    )?;
    assert!(!control_allows_successor_entry(
        &command_a,
        &operation("predecessor")?,
        &stale_entry
    ));

    let replacement_entry = authority_entry(
        &authority_context()?,
        1,
        "replacement/e1/w2/t3/o0/f0",
        AuthorityEntryKind::ReplacementCommit,
        json!({"sourceAddress": {"epoch": 1, "wave": 2, "turn": 3}}),
        replacement.clone(),
    )?;
    assert!(control_allows_successor_entry(
        &replacement,
        &operation("predecessor")?,
        &replacement_entry
    ));

    let shared_result = NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/current")?,
        owner_seat_id: seat(1),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        surface_class: "op:reward".to_owned(),
        operation_kind: "REWARD_PRESENT".to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned()],
            operation_ids: Some(vec![operation("interaction/result")?]),
        },
    });
    let interaction_entry = authority_entry(
        &authority_context()?,
        1,
        "interaction/result",
        AuthorityEntryKind::InteractionCommit,
        json!({"surfaceClass": "op:reward", "envelope": {"sessionEpoch": 1, "wave": 2, "turn": 3, "pendingOperation": {"kind": "REWARD"}}}),
        shared_result.clone(),
    )?;
    assert!(control_allows_successor_entry(
        &shared_result,
        &operation("predecessor")?,
        &interaction_entry
    ));

    let mut wait_value = match wait {
        NextControl::AwaitSuccessor(value) => value,
        _ => {
            return Err(missing(
                "seed=0 operation=successor-wait-control: await helper returned another control",
            ));
        }
    };
    wait_value.allowed_kinds = vec![
        AuthorityEntryKind::ControlCommit,
        AuthorityEntryKind::InteractionCommit,
    ];
    assert!(successor_wait_allows(
        &wait_value,
        &operation("predecessor")?,
        AuthorityEntryKind::ControlCommit,
        &operation("control/4")?,
        safe(1),
        &json!({"kind": "command-open", "wave": 2, "turn": 4}),
    ));
    assert!(!successor_wait_allows(
        &wait_value,
        &operation("different-predecessor")?,
        AuthorityEntryKind::ControlCommit,
        &operation("control/4")?,
        safe(1),
        &json!({"kind": "command-open", "wave": 2, "turn": 4}),
    ));
    assert!(!successor_wait_allows(
        &wait_value,
        &operation("predecessor")?,
        AuthorityEntryKind::ControlCommit,
        &operation("control/3")?,
        safe(1),
        &json!({"kind": "command-open", "wave": 2, "turn": 3}),
    ));
    let proof = er_protocol::LocalPresentationInputProof {
        session_epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        phase_name: "LevelUpPhase".to_owned(),
        message_handler_actionable: true,
    };
    wait_value.allow_next_wave_start = true;
    assert!(successor_wait_allows_local_presentation_input(
        &wait_value,
        &proof
    ));
    assert!(!successor_wait_allows_local_presentation_input(
        &wait_value,
        &er_protocol::LocalPresentationInputProof {
            phase_name: "MessagePhase".to_owned(),
            ..proof
        }
    ));
    Ok(())
}

#[test]
fn recovery_seeded_bundles_and_fences_fail_closed_with_ordered_phases() -> TestResult {
    let mut fence = RecoveryFence::new();
    assert_eq!(fence.state(), RecoveryFenceState::Open);
    assert_eq!(fence.terminal_reason(), None);
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
    assert!(!fence.is_control_surface_start_frozen());
    assert!(!fence.is_authority_wait_creation_frozen());
    fence.release();
    assert_eq!(fence.state(), RecoveryFenceState::Open);
    fence.terminalize("first terminal reason".to_owned());
    fence.terminalize("second terminal reason".to_owned());
    fence.release();
    assert_eq!(fence.state(), RecoveryFenceState::Terminal);
    assert_eq!(fence.terminal_reason(), Some("first terminal reason"));
    assert!(fence.view().command_admission_frozen);

    for captured in 0..=5_u64 {
        for frontier in 0..=6_u64 {
            let operation = captured * 10 + frontier;
            let bundle = replay(
                0,
                format!("recovery-bundle-{captured}-{frontier}"),
                recovered_bundle(captured, frontier),
            )?;
            let validation_context = replay(
                0,
                format!("recovery-validation-context-{captured}"),
                recovery_validation_context(captured),
            )?;
            let verdict = er_protocol::validate_recovery_bundle(&validation_context, &bundle);
            if frontier < captured {
                assert!(
                    matches!(verdict, RecoveryBundleValidation::Stale { .. }),
                    "seed=0 operation={operation} captured={captured} frontier={frontier} stale classification"
                );
            } else {
                assert!(
                    matches!(verdict, RecoveryBundleValidation::Valid { .. }),
                    "seed=0 operation={operation} captured={captured} frontier={frontier} valid classification"
                );
            }
        }
    }
    let mut invalid_zero = recovered_bundle(0, 0)?;
    invalid_zero.frontier_operation_id = Some(operation("unexpected")?);
    assert!(matches!(
        er_protocol::validate_recovery_bundle(&recovery_validation_context(0)?, &invalid_zero),
        RecoveryBundleValidation::Mismatch { .. }
    ));
    let mut invalid_tail = recovered_bundle(2, 4)?;
    invalid_tail.required_tail[1].revision = revision(9);
    assert!(matches!(
        er_protocol::validate_recovery_bundle(&recovery_validation_context(2)?, &invalid_tail),
        RecoveryBundleValidation::Mismatch { .. }
    ));
    let mut invalid_context = recovered_bundle(2, 4)?;
    invalid_context.context = replica_context()?;
    assert!(matches!(
        er_protocol::validate_recovery_bundle(&recovery_validation_context(2)?, &invalid_context),
        RecoveryBundleValidation::Mismatch { .. }
    ));
    let mut invalid_request = recovered_bundle(2, 4)?;
    invalid_request.request_id = "other-request".to_owned();
    assert!(matches!(
        er_protocol::validate_recovery_bundle(&recovery_validation_context(2)?, &invalid_request),
        RecoveryBundleValidation::Mismatch { .. }
    ));

    let mut out_of_order = recovery_transaction()?;
    let mut out_of_order_scheduler = KernelScheduler::new();
    assert!(matches!(
        out_of_order.material_result(
            RecoveryMaterialOutcome::Applied,
            live_recovery_state(0)?,
            &mut out_of_order_scheduler,
        ),
        Err(RecoveryError::InvalidPhase { phase: None })
    ));
    let _ = out_of_order.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "phase-order".to_owned(),
        &mut out_of_order_scheduler,
    )?;
    assert!(matches!(
        out_of_order.control_result(
            ControlProjectionOutcome::Deferred,
            live_recovery_state(1)?,
            &mut out_of_order_scheduler,
        ),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::Requested)
        })
    ));
    assert!(matches!(
        out_of_order.recovered_frontier_staged(
            RecoveryFrontierStagingOutcome::Rejected {
                reason: "stage-before-material".to_owned(),
            },
            live_recovery_state(1)?,
            &mut out_of_order_scheduler,
        ),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::Requested)
        })
    ));
    assert!(matches!(
        out_of_order.start(
            "again".to_owned(),
            authority_frontier(1),
            "duplicate".to_owned(),
            &mut out_of_order_scheduler,
        ),
        Err(RecoveryError::FenceHeld)
    ));
    assert!(matches!(
        out_of_order.timer_fired(
            ScheduledTimer {
                endpoint: seat(1),
                timer_id: TimerId::new(safe(99)),
                owner: timer_owner("unknown", "unknown", "unknown"),
                delay_ms: safe(1),
                time_class: TimeClass::Recovery,
            },
            live_recovery_state(1)?,
            &mut out_of_order_scheduler,
        ),
        Err(RecoveryError::InvalidPhase {
            phase: Some(RecoveryPhase::Requested)
        })
    ));
    let _ = out_of_order.dispose("out-of-order teardown", &mut out_of_order_scheduler);
    assert!(
        out_of_order.diagnostics().disposed,
        "seed=0 operation=recovery-dispose disposed transaction"
    );
    assert!(
        out_of_order_scheduler.live_timers().is_empty(),
        "seed=0 operation=recovery-dispose scheduler resource zero"
    );
    assert!(
        out_of_order
            .dispose("duplicate teardown", &mut out_of_order_scheduler)
            .is_empty(),
        "seed=0 operation=recovery-dispose idempotent disposal"
    );

    let mut stale = recovery_transaction()?;
    let mut stale_scheduler = KernelScheduler::new();
    let _ = stale.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "stale".to_owned(),
        &mut stale_scheduler,
    )?;
    let stale_actions = stale.accept_bundle(
        recovered_bundle(1, 3)?,
        live_recovery_state(2)?,
        &mut stale_scheduler,
    )?;
    assert_recovery_terminalized(&stale_actions, &[0], 0, "recovery-stale");
    assert_eq!(stale.phase(), Some(RecoveryPhase::Terminalized));
    assert_eq!(
        stale.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Terminal)
    );
    assert!(stale.diagnostics().timer_ids.is_empty());

    let mut generation_stale = recovery_transaction()?;
    let mut generation_stale_scheduler = KernelScheduler::new();
    generation_stale.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "generation-stale".to_owned(),
        &mut generation_stale_scheduler,
    )?;
    let mut changed_live = live_recovery_state(1)?;
    changed_live.context = context(1, 0, 2, 99, 3)?;
    let changed_actions = generation_stale.accept_bundle(
        recovered_bundle(1, 3)?,
        changed_live,
        &mut generation_stale_scheduler,
    )?;
    assert_recovery_terminalized(&changed_actions, &[0], 0, "recovery-generation");
    assert_eq!(
        generation_stale.phase(),
        Some(RecoveryPhase::Terminalized),
        "seed=0 operation=recovery-generation terminal phase"
    );
    assert!(generation_stale_scheduler.live_timers().is_empty());

    let mut material_live_stale = recovery_transaction()?;
    let mut material_live_stale_scheduler = KernelScheduler::new();
    material_live_stale.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "material-live-stale".to_owned(),
        &mut material_live_stale_scheduler,
    )?;
    material_live_stale.accept_bundle(
        recovered_bundle(1, 3)?,
        live_recovery_state(1)?,
        &mut material_live_stale_scheduler,
    )?;
    let material_live_stale_actions = material_live_stale.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(2)?,
        &mut material_live_stale_scheduler,
    )?;
    assert_recovery_terminalized(
        &material_live_stale_actions,
        &[],
        0,
        "recovery-material-live",
    );
    assert!(material_live_stale_scheduler.live_timers().is_empty());

    let mut control_live_stale = recovery_transaction()?;
    let mut control_live_stale_scheduler = KernelScheduler::new();
    control_live_stale.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "control-live-stale".to_owned(),
        &mut control_live_stale_scheduler,
    )?;
    control_live_stale.accept_bundle(
        recovered_bundle(1, 3)?,
        live_recovery_state(1)?,
        &mut control_live_stale_scheduler,
    )?;
    control_live_stale.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(1)?,
        &mut control_live_stale_scheduler,
    )?;
    let mut control_live_stale_replica = replica()?;
    let control_live_stale_entry = recovered_bundle(1, 3)?
        .required_tail
        .last()
        .cloned()
        .ok_or_else(|| missing("seed=0 operation=recovery-control-live missing final entry"))?;
    let control_live_stale_revision = stage_recovered_entry(
        &mut control_live_stale_replica,
        control_live_stale_entry,
        GOLDEN_AUTHORITY_CONTROL_ID,
        0,
        "recovery-control-live-stage",
    )?;
    control_live_stale.recovered_frontier_staged(
        RecoveryFrontierStagingOutcome::Staged {
            revision: control_live_stale_revision,
        },
        staged_recovery_state(control_live_stale_revision.get().get())?,
        &mut control_live_stale_scheduler,
    )?;
    let control_live_stale_actions = control_live_stale.control_result(
        ControlProjectionOutcome::Deferred,
        live_recovery_state(2)?,
        &mut control_live_stale_scheduler,
    )?;
    assert_recovery_terminalized(
        &control_live_stale_actions,
        &[1],
        0,
        "recovery-control-live",
    );
    assert!(control_live_stale_scheduler.live_timers().is_empty());
    control_live_stale_replica.dispose("control live stale teardown");

    let mut wrong_control = recovery_transaction()?;
    let mut wrong_control_scheduler = KernelScheduler::new();
    let _ = wrong_control.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "wrong-control".to_owned(),
        &mut wrong_control_scheduler,
    )?;
    let _ = wrong_control.accept_bundle(
        recovered_bundle(1, 3)?,
        live_recovery_state(1)?,
        &mut wrong_control_scheduler,
    )?;
    let _ = wrong_control.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(1)?,
        &mut wrong_control_scheduler,
    )?;
    let mut wrong_control_replica = replica()?;
    let wrong_control_entry = recovered_bundle(1, 3)?
        .required_tail
        .last()
        .cloned()
        .ok_or_else(|| missing("seed=0 operation=recovery-wrong-control missing final entry"))?;
    let wrong_control_revision = stage_recovered_entry(
        &mut wrong_control_replica,
        wrong_control_entry,
        GOLDEN_AUTHORITY_CONTROL_ID,
        0,
        "recovery-wrong-control-stage",
    )?;
    let _ = wrong_control.recovered_frontier_staged(
        RecoveryFrontierStagingOutcome::Staged {
            revision: wrong_control_revision,
        },
        staged_recovery_state(wrong_control_revision.get().get())?,
        &mut wrong_control_scheduler,
    )?;
    let wrong_actions = wrong_control.control_result(
        ControlProjectionOutcome::Installed {
            control_id: "wrong-control-id".to_owned(),
        },
        live_recovery_state(wrong_control_revision.get().get())?,
        &mut wrong_control_scheduler,
    )?;
    assert_eq!(wrong_control.phase(), Some(RecoveryPhase::Terminalized));
    assert_eq!(
        wrong_control.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Terminal)
    );
    assert_recovery_terminalized(&wrong_actions, &[1], 0, "recovery-wrong-control");
    wrong_control_replica.dispose("wrong control teardown");

    let mut happy = recovery_transaction()?;
    let mut happy_scheduler = KernelScheduler::new();
    let start = happy.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "rejoin".to_owned(),
        &mut happy_scheduler,
    )?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::Requested));
    assert_eq!(
        happy.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Held)
    );
    assert!(
        matches!(start.first(), Some(RecoveryAction::FenceChanged { view }) if view.state == RecoveryFenceState::Held)
    );
    let request_timer = assert_recovery_schedule(
        &start[1],
        0,
        GOLDEN_RECOVERY_REQUEST_TIMEOUT_MS,
        TimeClass::Recovery,
        "recovery/session-1/run-1/recovery-1",
        "authority-v2 recovery request deadline",
        0,
        "recovery-start-timer",
    );
    assert!(happy_scheduler.timer(request_timer.timer_id).is_some());
    assert!(
        matches!(start.get(2), Some(RecoveryAction::SendRequest { request }) if request.request_id == "recovery-1" && request.captured_frontier == revision(1))
    );
    let happy_bundle = recovered_bundle(1, 3)?;
    assert!(
        happy
            .accept_bundle(
                happy_bundle.clone(),
                live_recovery_state(1)?,
                &mut happy_scheduler,
            )
            .is_ok()
    );
    assert_eq!(happy.phase(), Some(RecoveryPhase::Validated));
    let material = happy.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(1)?,
        &mut happy_scheduler,
    )?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::MaterialApplied));
    let final_entry = happy_bundle
        .required_tail
        .last()
        .cloned()
        .ok_or_else(|| missing("seed=0 operation=recovery-stage missing full final entry"))?;
    match material.as_slice() {
        [RecoveryAction::StageRecoveredFrontier { entry }] => {
            assert_eq!(
                entry, &final_entry,
                "seed=0 operation=recovery-stage action carries full final entry"
            );
        }
        other => panic!("seed=0 operation=recovery-stage action order was {other:?}"),
    }
    // CR-0011: the transaction may report Staged only after the replica has
    // accepted the complete final entry, including material identity and its
    // successor control. Terminal-only adoption is not sufficient here.
    let mut happy_replica = replica()?;
    let staged_revision = stage_recovered_entry(
        &mut happy_replica,
        final_entry.clone(),
        GOLDEN_AUTHORITY_CONTROL_ID,
        0,
        "recovery-stage-replica",
    )?;
    let staged = happy.recovered_frontier_staged(
        RecoveryFrontierStagingOutcome::Staged {
            revision: staged_revision,
        },
        staged_recovery_state(staged_revision.get().get())?,
        &mut happy_scheduler,
    )?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::FrontierInstalled));
    assert!(happy.fence_view().is_some_and(
        |view| !view.control_surface_start_frozen && !view.authority_wait_creation_frozen
    ));
    assert!(
        matches!(staged.first(), Some(RecoveryAction::FenceChanged { view }) if view.state == RecoveryFenceState::Held)
    );
    assert_recovery_schedule(
        &staged[1],
        1,
        GOLDEN_RECOVERY_CONTROL_TIMEOUT_MS,
        TimeClass::Recovery,
        "recovery-control/session-1/run-1/recovery-1",
        "await exact Authority V2 recovery control proof",
        0,
        "recovery-stage-control-timer",
    );
    match staged.get(2) {
        Some(RecoveryAction::ProjectControl {
            revision: projected_revision,
            control,
            expected_control_id,
        }) => {
            assert_eq!(
                *projected_revision, staged_revision,
                "seed=0 operation=recovery-stage-control projected revision"
            );
            assert_eq!(
                control, &final_entry.next_control,
                "seed=0 operation=recovery-stage-control exact control"
            );
            assert_eq!(
                expected_control_id.as_str(),
                GOLDEN_AUTHORITY_CONTROL_ID,
                "seed=0 operation=recovery-stage-control exact control id"
            );
        }
        other => panic!("seed=0 operation=recovery-stage-control projection index was {other:?}"),
    }
    let happy_replica_control = happy_replica.control_result(
        staged_revision,
        ControlProjectionOutcome::Installed {
            control_id: GOLDEN_AUTHORITY_CONTROL_ID.to_owned(),
        },
    )?;
    assert_replica_control_actions(
        &happy_replica_control,
        &final_entry,
        GOLDEN_AUTHORITY_CONTROL_ID,
        0,
        "recovery-stage-control-replica",
    );
    let expected_recovery_control = recovered_bundle(1, 3)?
        .next_control
        .ok_or_else(|| missing("seed=0 operation=recovery-control missing expected control"))?;
    assert_eq!(
        control_id_of(&expected_recovery_control),
        GOLDEN_AUTHORITY_CONTROL_ID,
        "seed=0 operation=recovery-control golden identity"
    );
    let installed = happy.control_result(
        ControlProjectionOutcome::Installed {
            control_id: GOLDEN_AUTHORITY_CONTROL_ID.to_owned(),
        },
        live_recovery_state(staged_revision.get().get())?,
        &mut happy_scheduler,
    )?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::Released));
    assert_eq!(
        happy.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Open)
    );
    assert_eq!(
        installed.len(),
        3,
        "seed=0 operation=recovery-control-install exact action count"
    );
    assert!(matches!(
        installed.first(),
        Some(RecoveryAction::Scheduler {
            command: SchedulerCommand::Cancel { endpoint, timer_id }
        }) if *endpoint == seat(1) && *timer_id == TimerId::new(safe(1))
    ));
    assert!(
        matches!(installed.get(1), Some(RecoveryAction::SendAppliedProof { proof }) if proof.frontier == staged_revision && proof.control_id.as_deref() == Some(GOLDEN_AUTHORITY_CONTROL_ID))
    );
    assert!(
        matches!(installed.get(2), Some(RecoveryAction::FenceChanged { view }) if view.state == RecoveryFenceState::Open)
    );
    assert!(happy.diagnostics().timer_ids.is_empty());
    assert!(happy_scheduler.live_timers().is_empty());
    happy_replica.dispose("recovery full-entry teardown");

    let mut rejected_stage = recovery_transaction()?;
    let mut rejected_stage_scheduler = KernelScheduler::new();
    rejected_stage.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "rejected-stage".to_owned(),
        &mut rejected_stage_scheduler,
    )?;
    rejected_stage.accept_bundle(
        recovered_bundle(1, 3)?,
        live_recovery_state(1)?,
        &mut rejected_stage_scheduler,
    )?;
    rejected_stage.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(1)?,
        &mut rejected_stage_scheduler,
    )?;
    let rejected_stage_actions = rejected_stage.recovered_frontier_staged(
        RecoveryFrontierStagingOutcome::Rejected {
            reason: "replica refused complete final entry".to_owned(),
        },
        live_recovery_state(1)?,
        &mut rejected_stage_scheduler,
    )?;
    assert_recovery_terminalized(
        &rejected_stage_actions,
        &[],
        0,
        "recovery-frontier-rejected",
    );
    assert_eq!(
        rejected_stage.phase(),
        Some(RecoveryPhase::Terminalized),
        "seed=0 operation=recovery-frontier-rejected phase"
    );
    assert!(
        rejected_stage_scheduler.live_timers().is_empty(),
        "seed=0 operation=recovery-frontier-rejected resources"
    );

    let mut control_rejected = recovery_transaction()?;
    let mut control_rejected_scheduler = KernelScheduler::new();
    control_rejected.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "rejected-control".to_owned(),
        &mut control_rejected_scheduler,
    )?;
    let control_rejected_bundle = recovered_bundle(1, 3)?;
    control_rejected.accept_bundle(
        control_rejected_bundle.clone(),
        live_recovery_state(1)?,
        &mut control_rejected_scheduler,
    )?;
    control_rejected.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(1)?,
        &mut control_rejected_scheduler,
    )?;
    let mut control_rejected_replica = replica()?;
    let control_rejected_entry = control_rejected_bundle
        .required_tail
        .last()
        .cloned()
        .ok_or_else(|| missing("seed=0 operation=recovery-control-rejected missing final entry"))?;
    let control_rejected_revision = stage_recovered_entry(
        &mut control_rejected_replica,
        control_rejected_entry.clone(),
        GOLDEN_AUTHORITY_CONTROL_ID,
        0,
        "recovery-control-rejected-stage",
    )?;
    control_rejected.recovered_frontier_staged(
        RecoveryFrontierStagingOutcome::Staged {
            revision: control_rejected_revision,
        },
        staged_recovery_state(control_rejected_revision.get().get())?,
        &mut control_rejected_scheduler,
    )?;
    let control_rejected_actions = control_rejected.control_result(
        ControlProjectionOutcome::Rejected {
            reason: "projection unavailable".to_owned(),
        },
        staged_recovery_state(control_rejected_revision.get().get())?,
        &mut control_rejected_scheduler,
    )?;
    assert_recovery_terminalized(
        &control_rejected_actions,
        &[1],
        0,
        "recovery-control-rejected",
    );
    assert_eq!(
        control_rejected.phase(),
        Some(RecoveryPhase::Terminalized),
        "seed=0 operation=recovery-control-rejected phase"
    );
    assert!(
        control_rejected_scheduler.live_timers().is_empty(),
        "seed=0 operation=recovery-control-rejected resources"
    );
    control_rejected_replica.dispose("rejected control teardown");

    let mut control_timeout = recovery_transaction()?;
    let mut control_timeout_scheduler = KernelScheduler::new();
    control_timeout.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "control-timeout".to_owned(),
        &mut control_timeout_scheduler,
    )?;
    let control_timeout_bundle = recovered_bundle(1, 3)?;
    control_timeout.accept_bundle(
        control_timeout_bundle.clone(),
        live_recovery_state(1)?,
        &mut control_timeout_scheduler,
    )?;
    control_timeout.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(1)?,
        &mut control_timeout_scheduler,
    )?;
    let mut control_timeout_replica = replica()?;
    let control_timeout_entry = control_timeout_bundle
        .required_tail
        .last()
        .cloned()
        .ok_or_else(|| missing("seed=0 operation=recovery-control-timeout missing final entry"))?;
    let control_timeout_revision = stage_recovered_entry(
        &mut control_timeout_replica,
        control_timeout_entry.clone(),
        GOLDEN_AUTHORITY_CONTROL_ID,
        0,
        "recovery-control-timeout-stage",
    )?;
    let control_staged = control_timeout.recovered_frontier_staged(
        RecoveryFrontierStagingOutcome::Staged {
            revision: control_timeout_revision,
        },
        staged_recovery_state(control_timeout_revision.get().get())?,
        &mut control_timeout_scheduler,
    )?;
    let control_timer = assert_recovery_schedule(
        &control_staged[1],
        1,
        GOLDEN_RECOVERY_CONTROL_TIMEOUT_MS,
        TimeClass::Recovery,
        "recovery-control/session-1/run-1/recovery-1",
        "await exact Authority V2 recovery control proof",
        0,
        "recovery-control-timeout-schedule",
    );
    let control_timeout_fired =
        fire_exact_timer(&mut control_timeout_scheduler, &control_timer, 0, 1)?;
    let control_timeout_actions = control_timeout.timer_fired(
        control_timeout_fired,
        staged_recovery_state(control_timeout_revision.get().get())?,
        &mut control_timeout_scheduler,
    )?;
    assert_recovery_terminalized(&control_timeout_actions, &[], 0, "recovery-control-timeout");
    assert_eq!(
        control_timeout.phase(),
        Some(RecoveryPhase::Terminalized),
        "seed=0 operation=recovery-control-timeout phase"
    );
    assert!(
        control_timeout_scheduler.live_timers().is_empty(),
        "seed=0 operation=recovery-control-timeout resources"
    );
    control_timeout_replica.dispose("control timeout teardown");

    let mut zero = recovery_transaction()?;
    let mut zero_scheduler = KernelScheduler::new();
    zero.start(
        "recovery-1".to_owned(),
        authority_frontier(0),
        "empty".to_owned(),
        &mut zero_scheduler,
    )?;
    zero.accept_bundle(
        recovered_bundle(0, 0)?,
        live_recovery_state(0)?,
        &mut zero_scheduler,
    )?;
    let zero_actions = zero.material_result(
        RecoveryMaterialOutcome::Applied,
        live_recovery_state(0)?,
        &mut zero_scheduler,
    )?;
    assert_eq!(zero.phase(), Some(RecoveryPhase::Released));
    assert_eq!(
        zero_actions.len(),
        2,
        "seed=0 operation=recovery-zero exact action count"
    );
    assert!(
        matches!(zero_actions.first(), Some(RecoveryAction::SendAppliedProof { proof }) if proof.frontier == revision(0) && proof.control_id.is_none())
    );
    assert!(
        matches!(zero_actions.get(1), Some(RecoveryAction::FenceChanged { view }) if view.state == RecoveryFenceState::Open)
    );
    assert!(
        zero_scheduler.live_timers().is_empty(),
        "seed=0 operation=recovery-zero disposal resource zero"
    );

    for outcome in [
        RecoveryMaterialOutcome::Deferred,
        RecoveryMaterialOutcome::Rejected,
    ] {
        let mut failed = recovery_transaction()?;
        let mut failed_scheduler = KernelScheduler::new();
        failed.start(
            "recovery-1".to_owned(),
            authority_frontier(1),
            "failure".to_owned(),
            &mut failed_scheduler,
        )?;
        failed.accept_bundle(
            recovered_bundle(1, 3)?,
            live_recovery_state(1)?,
            &mut failed_scheduler,
        )?;
        let actions =
            failed.material_result(outcome, live_recovery_state(1)?, &mut failed_scheduler)?;
        assert_eq!(failed.phase(), Some(RecoveryPhase::Terminalized));
        assert!(
            failed
                .fence_view()
                .is_some_and(|view| view.state == RecoveryFenceState::Terminal)
        );
        assert_recovery_terminalized(&actions, &[], 0, "recovery-material-failure");
    }

    let mut timeout = recovery_transaction()?;
    let mut timeout_scheduler = KernelScheduler::new();
    let timeout_start = timeout.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "timeout".to_owned(),
        &mut timeout_scheduler,
    )?;
    let timeout_timer = assert_recovery_schedule(
        &timeout_start[1],
        0,
        GOLDEN_RECOVERY_REQUEST_TIMEOUT_MS,
        TimeClass::Recovery,
        "recovery/session-1/run-1/recovery-1",
        "authority-v2 recovery request deadline",
        0,
        "recovery-timeout-schedule",
    );
    let timeout_fired = fire_exact_timer(&mut timeout_scheduler, &timeout_timer, 0, 1)?;
    let timeout_actions = timeout.timer_fired(
        timeout_fired,
        live_recovery_state(1)?,
        &mut timeout_scheduler,
    )?;
    assert_eq!(timeout.phase(), Some(RecoveryPhase::Terminalized));
    assert!(
        timeout
            .fence_view()
            .is_some_and(|view| view.state == RecoveryFenceState::Terminal)
    );
    assert_recovery_terminalized(&timeout_actions, &[], 0, "recovery-request-timeout");
    assert!(timeout.diagnostics().timer_ids.is_empty());

    let mut malformed_timeout = recovery_transaction()?;
    let mut malformed_timeout_scheduler = KernelScheduler::new();
    let malformed_start = malformed_timeout.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "malformed-timeout".to_owned(),
        &mut malformed_timeout_scheduler,
    )?;
    let malformed_timer = assert_recovery_schedule(
        &malformed_start[1],
        0,
        GOLDEN_RECOVERY_REQUEST_TIMEOUT_MS,
        TimeClass::Recovery,
        "recovery/session-1/run-1/recovery-1",
        "authority-v2 recovery request deadline",
        0,
        "recovery-malformed-schedule",
    );
    let removed_malformed =
        fire_exact_timer(&mut malformed_timeout_scheduler, &malformed_timer, 0, 2)?;
    let mut wrong_malformed = removed_malformed.clone();
    wrong_malformed.time_class = TimeClass::Connected;
    let before_malformed_timeout = malformed_timeout.diagnostics();
    let before_malformed_timeout_scheduler = scheduler_snapshot(&malformed_timeout_scheduler);
    assert!(
        malformed_timeout
            .timer_fired(
                wrong_malformed,
                live_recovery_state(1)?,
                &mut malformed_timeout_scheduler,
            )
            .is_err(),
        "seed=0 operation=recovery-malformed stale timer rejected"
    );
    assert_eq!(
        malformed_timeout.phase(),
        Some(RecoveryPhase::Requested),
        "seed=0 operation=recovery-malformed state preserved"
    );
    assert_eq!(
        malformed_timeout.diagnostics(),
        before_malformed_timeout,
        "seed=0 operation=recovery-malformed preserves complete recovery diagnostics"
    );
    assert_eq!(
        scheduler_snapshot(&malformed_timeout_scheduler),
        before_malformed_timeout_scheduler,
        "seed=0 operation=recovery-malformed preserves complete scheduler resources"
    );
    let exact_timeout = malformed_timeout.timer_fired(
        removed_malformed,
        live_recovery_state(1)?,
        &mut malformed_timeout_scheduler,
    )?;
    assert_recovery_terminalized(&exact_timeout, &[], 0, "recovery-malformed-timeout");
    assert!(malformed_timeout_scheduler.live_timers().is_empty());

    let mut aborted = recovery_transaction()?;
    let mut aborted_scheduler = KernelScheduler::new();
    aborted.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "abort".to_owned(),
        &mut aborted_scheduler,
    )?;
    let first_abort = aborted.abort("operator cancellation".to_owned(), &mut aborted_scheduler);
    assert_recovery_terminalized(&first_abort, &[0], 0, "recovery-abort");
    assert!(
        matches!(first_abort.last(), Some(RecoveryAction::Terminalize { reason }) if reason == "operator cancellation")
    );
    assert!(
        aborted
            .abort("second cancellation".to_owned(), &mut aborted_scheduler)
            .is_empty()
    );
    assert!(matches!(
        aborted.start(
            "again".to_owned(),
            authority_frontier(0),
            "again".to_owned(),
            &mut aborted_scheduler,
        ),
        Err(RecoveryError::Terminalized { .. })
    ));
    assert!(
        aborted_scheduler.live_timers().is_empty(),
        "seed=0 operation=recovery-abort disposal resource zero"
    );

    let mut rollback_recovery = recovery_transaction()?;
    let mut rollback_scheduler = KernelScheduler::new();
    let _ = rollback_scheduler.dispose();
    let rollback_actions = rollback_recovery.start(
        "recovery-1".to_owned(),
        authority_frontier(1),
        "schedule-failure".to_owned(),
        &mut rollback_scheduler,
    )?;
    assert_recovery_terminalized(&rollback_actions, &[], 0, "recovery-rollback");
    assert_eq!(
        rollback_recovery.phase(),
        Some(RecoveryPhase::Terminalized),
        "seed=0 operation=recovery-rollback phase rollback"
    );
    assert_eq!(
        rollback_recovery.fence_view().map(|view| view.state),
        Some(RecoveryFenceState::Terminal),
        "seed=0 operation=recovery-rollback fence rollback"
    );
    assert!(rollback_recovery.diagnostics().timer_ids.is_empty());
    assert!(rollback_scheduler.live_timers().is_empty());
    Ok(())
}
