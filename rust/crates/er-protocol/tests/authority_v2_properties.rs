use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::panic::{AssertUnwindSafe, catch_unwind};

use er_protocol::{
    AuthorityEntryDraft, AuthorityLog, AuthorityLogAction, AuthorityLogConfig, AuthorityReceiptVerdict,
    AuthorityReplica, AuthorityReplicaConfig, BackoffPolicy, ControlProjectionOutcome,
    FrameValidator, InboundFrameResult, KernelScheduler, ProposalAdmission, ProposalAdmissionLedger,
    ProposalFingerprintInput, ProposalJson, ProposalLeaseAction, ProposalLeaseConfig, ProposalLeaseManager,
    ProposalLeaseSpec, ProposalLeaseStart, ProposalMessage, ProposalIdentity, ReceiptRejectReason,
    RecoveryAction, RecoveryBundleValidation, RecoveryError, RecoveryFence, RecoveryFenceState,
    RecoveryMaterialOutcome, RecoveryTransaction, RecoveryTransactionConfig, RecoveryValidationContext,
    ReplicaAction, ReplicaAdmission, ReplicaRejectReason, ReplicaResume, ScheduledTimer, SchedulerCommand,
    SchedulerError, SuccessorValidator, control_allows_successor_entry, control_id_of, control_owner_seat_id,
    control_owner_seat_ids, controls_equal, fingerprint_bargain, fingerprint_biome_shop_buy,
    fingerprint_biome_shop_leave, fingerprint_reward, frame_context_issues, frame_contexts_compatible,
    frame_contexts_equal, is_valid_next_control, next_control_issues, partition_control_for_seat,
    proposal_fingerprint, same_control_address, successor_wait_allows, successor_wait_allows_local_presentation_input,
    validate_inbound_frame, validate_next_control,
    DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS, DEFAULT_RECOVERY_PACING_MS, DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS,
};
use er_types::{
    AckStage, AuthorityEntry, AuthorityEntryKind, AuthorityFrontier, AuthorityReceipt, AuthorityRecoverySlice,
    AwaitSuccessorControl, CommandControlTarget, CommandFrontierControl, ConnectionGeneration, FrameContext,
    FrameType, InteractionSuccessor, Material, MaterialApplicationOutcome, MembershipRevision, NextControl,
    OperationId, RawFrame, RecoveredFrontierTerminal, RecoveryBundle, RecoveryPhase, Revision,
    RunId, SafeI53, SafeU53, SeatId, SessionId, SharedInteractionControl, TerminalControl, TimeClass, TimerId,
    TimerOwner,
};
use serde_json::{Map, Value, json};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn signed(value: i64) -> SafeI53 {
    SafeI53::new(value).unwrap_or(SafeI53::ZERO)
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

fn command_control(epoch: u64, wave: u64, turn: u64, commands: Vec<CommandControlTarget>) -> NextControl {
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
        remaining: vec![er_types::ReplacementControlAddress {
            operation_id: operation("replacement/tail/1")?,
            owner_seat_id: seat(1),
            epoch: safe(1),
            wave: safe(2),
            turn: safe(3),
            occurrence: safe(1),
            field_index: safe(1),
        }],
    }))
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

fn authority_log(capacity: u64, peer_generations: &[(u64, u64)]) -> Result<AuthorityLog, Box<dyn Error>> {
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
            initial_ms: safe(250),
            maximum_ms: safe(5_000),
            factor_numerator: safe(2),
            factor_denominator: safe(1),
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: Some(safe(4)),
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
        "seed={seed} stage={stage} frontier order: {:?}",
        frontier
    );
    match replica.pending_entry() {
        Some(entry) => {
            assert_eq!(
                entry.revision, frontier.received,
                "seed={seed} stage={stage} pending entry is not the received frontier"
            );
            assert!(
                frontier.control < frontier.received,
                "seed={seed} stage={stage} pending entry coexists with a complete control frontier"
            );
            assert!(
                frontier.material == frontier.control || frontier.material == frontier.received,
                "seed={seed} stage={stage} pending entry has a non-stage frontier: {:?}",
                frontier
            );
        }
        None => assert_eq!(
            frontier.received, frontier.control,
            "seed={seed} stage={stage} no pending entry but control frontier is incomplete"
        ),
    }
}

fn replica_entry(revision_value: u64, operation_value: &str) -> Result<AuthorityEntry, Box<dyn Error>> {
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
        request_timeout_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
        control_timeout_ms: safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS),
        pacing_ms: safe(DEFAULT_RECOVERY_PACING_MS),
        timer_owner_id: "recovery-property".to_owned(),
    })?)
}

fn scheduled_timer_from(actions: &[RecoveryAction], delay: SafeU53) -> Option<TimerId> {
    actions.iter().find_map(|action| match action {
        RecoveryAction::Scheduler {
            command: SchedulerCommand::Schedule { timer },
        } if timer.delay_ms == delay => Some(timer.timer_id),
        _ => None,
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
        if bound == 0 {
            0
        } else {
            self.next() % bound
        }
    }
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

fn assert_scheduler_pause_model(
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
                && reasons
                    .iter()
                    .any(|(owned_endpoint, owned_class, _)| {
                        *owned_endpoint == endpoint && *owned_class == time_class
                    });
            assert_eq!(
                scheduler.is_class_paused(endpoint, time_class),
                expected,
                "seed={seed} step={step} pause model endpoint={endpoint} class={time_class:?}"
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
        let mut pause_reasons = BTreeSet::<(SeatId, TimeClass, String)>::new();

        for step in 0..64_usize {
            match rng.below(6) {
                0 => {
                    let endpoint = seat(rng.below(3));
                    let owner_id = if rng.below(2) == 0 { "owner-a" } else { "owner-b" };
                    let time_class = class_for(rng.next());
                    let owner = timer_owner(
                        owner_id,
                        &format!("property/{seed}/{step}"),
                        "seeded property timer",
                    );
                    let result = scheduler.schedule(endpoint, owner.clone(), safe(1 + rng.below(500)), time_class);
                    let command = match result {
                        Ok(command) => command,
                        Err(error) => return Err(Box::new(error)),
                    };
                    let timer = match command {
                        SchedulerCommand::Schedule { timer } => timer,
                        other => return Err(format!("unexpected schedule command: {other:?}").into()),
                    };
                    assert_eq!(timer.endpoint, endpoint, "seed={seed} step={step} endpoint");
                    assert_eq!(timer.owner, owner, "seed={seed} step={step} owner");
                    assert_eq!(timer.time_class, time_class, "seed={seed} step={step} class");
                    assert!(live.insert(timer.timer_id, timer.clone()).is_none(), "seed={seed} step={step} duplicate timer id");
                }
                1 => {
                    let timer_id = if let Some(timer_id) = live.keys().next().copied() {
                        timer_id
                    } else {
                        TimerId::new(safe(900_000 + seed * 100 + step as u64))
                    };
                    let expected = live.remove(&timer_id).map(|timer| SchedulerCommand::Cancel {
                        endpoint: timer.endpoint,
                        timer_id,
                    });
                    assert_eq!(scheduler.cancel(timer_id), expected, "seed={seed} step={step} cancel");
                }
                2 => {
                    let owner_id = if rng.below(2) == 0 { "owner-a" } else { "owner-b" };
                    let expected_ids = live
                        .iter()
                        .filter_map(|(timer_id, timer)| (timer.owner.owner_id == owner_id).then_some(*timer_id))
                        .collect::<Vec<_>>();
                    let expected = expected_ids
                        .iter()
                        .filter_map(|timer_id| live.get(timer_id))
                        .map(|timer| SchedulerCommand::Cancel {
                            endpoint: timer.endpoint,
                            timer_id: timer.timer_id,
                        })
                        .collect::<Vec<_>>();
                    assert_eq!(scheduler.cancel_owner(owner_id), expected, "seed={seed} step={step} owner cancel");
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
                        assert_eq!(fired, Ok(expected_timer), "seed={seed} step={step} fired");
                    } else {
                        assert_eq!(fired, Err(SchedulerError::UnknownTimer { timer_id }), "seed={seed} step={step} unknown fired");
                    }
                }
                4 => {
                    let endpoint = seat(rng.below(3));
                    let time_class = class_for(rng.next());
                    let reason = format!("reason-{}", rng.below(3));
                    let already_paused = pause_reasons
                        .iter()
                        .any(|(owned_endpoint, owned_class, _)| *owned_endpoint == endpoint && *owned_class == time_class);
                    let result = scheduler.pause_class(endpoint, time_class, &reason);
                    if time_class == TimeClass::Absolute {
                        assert_eq!(result, Ok(None), "seed={seed} step={step} absolute pause");
                    } else {
                        let expected = (!already_paused).then(|| SchedulerCommand::PauseClass {
                            endpoint,
                            time_class,
                            reason: reason.clone(),
                        });
                        assert_eq!(result, Ok(expected), "seed={seed} step={step} pause");
                        pause_reasons.insert((endpoint, time_class, reason));
                    }
                }
                _ => {
                    let endpoint = seat(rng.below(3));
                    let time_class = class_for(rng.next());
                    let reason = format!("reason-{}", rng.below(3));
                    let existed = paused_reason_exists(&pause_reasons, endpoint, time_class, &reason);
                    let had_other_reason = pause_reasons.iter().any(|(owned_endpoint, owned_class, owned_reason)| {
                        *owned_endpoint == endpoint && *owned_class == time_class && owned_reason != &reason
                    });
                    let result = scheduler.resume_class(endpoint, time_class, &reason);
                    if time_class == TimeClass::Absolute {
                        assert_eq!(result, Ok(None), "seed={seed} step={step} absolute resume");
                    } else {
                        let expected = (existed && !had_other_reason).then(|| SchedulerCommand::ResumeClass {
                            endpoint,
                            time_class,
                            reason: reason.clone(),
                        });
                        assert_eq!(result, Ok(expected), "seed={seed} step={step} resume");
                        pause_reasons.remove(&(endpoint, time_class, reason));
                    }
                }
            }

            assert_eq!(scheduler.live_timers(), live.values().cloned().collect::<Vec<_>>(), "seed={seed} step={step} timer inventory");
            assert_eq!(scheduler.pending_timer_count(), safe(live.len() as u64), "seed={seed} step={step} timer count");
            assert_scheduler_pause_model(&scheduler, &pause_reasons, seed, step);
        }

        let expected_dispose = live
            .values()
            .map(|timer| SchedulerCommand::Cancel {
                endpoint: timer.endpoint,
                timer_id: timer.timer_id,
            })
            .collect::<Vec<_>>();
        assert_eq!(scheduler.dispose(), expected_dispose, "seed={seed} disposal commands");
        assert!(scheduler.is_disposed(), "seed={seed} disposed flag");
        assert!(scheduler.live_timers().is_empty(), "seed={seed} live timers after disposal");
        assert_eq!(scheduler.dispose(), Vec::new(), "seed={seed} idempotent disposal");
        assert_eq!(scheduler.cancel_owner("owner-a"), Vec::new(), "seed={seed} post-dispose owner cancel");
        assert_eq!(scheduler.pending_timer_count(), SafeU53::ZERO, "seed={seed} post-dispose count");
        assert_eq!(
            scheduler.schedule(seat(0), timer_owner("later", "later", "later"), safe(1), TimeClass::Connected),
            Err(SchedulerError::Disposed),
            "seed={seed} schedule after disposal",
        );
    }

    let mut gates = KernelScheduler::new();
    assert_eq!(gates.set_connected(seat(7), false)?, vec![SchedulerCommand::PauseClass {
        endpoint: seat(7),
        time_class: TimeClass::Connected,
        reason: "disconnected".to_owned(),
    }]);
    assert!(gates.is_class_paused(seat(7), TimeClass::Connected));
    assert_eq!(gates.set_suspended(seat(7), true)?.len(), 4);
    assert!(!gates.is_class_paused(seat(7), TimeClass::Absolute));
    assert_eq!(gates.set_suspended(seat(7), false)?.len(), 4);
    assert!(gates.is_class_paused(seat(7), TimeClass::Connected));
    assert_eq!(gates.set_connected(seat(7), true)?.len(), 1);
    assert!(!gates.is_class_paused(seat(7), TimeClass::Connected));
    Ok(())
}

#[test]
fn authority_log_seeded_commit_receipt_and_recovery_properties() -> TestResult {
    for seed in 0..8_u64 {
        let capacity = 2 + seed % 3;
        let mut log = authority_log(capacity, &[(1, 4)])?;
        let authority = authority_context()?;
        let invalid = draft(
            &authority,
            &format!("invalid-{seed}"),
            AuthorityEntryKind::TurnCommit,
            json!({"epoch": 3, "wave": 4, "turn": 1}),
            command_control(3, 4, 1, Vec::new()),
        )?;
        assert!(matches!(log.commit(invalid), Err(er_protocol::AuthorityLogError::InvalidEntry { .. })), "seed={seed} invalid commit");
        assert_eq!(log.head_revision(), Revision::ZERO, "seed={seed} invalid commit burned revision");

        for value in 1..=capacity {
            let outcome = log.commit(draft(
                &authority,
                &format!("operation-{seed}-{value}"),
                AuthorityEntryKind::TurnCommit,
                json!({"epoch": 3, "wave": 4, "turn": 1}),
                command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
            )?);
            let outcome = outcome?;
            assert_eq!(outcome.entry.revision, revision(value), "seed={seed} revision {value}");
            assert!(outcome.actions.iter().any(|action| matches!(action, AuthorityLogAction::Deliver { entry, .. } if entry.revision == revision(value))), "seed={seed} delivery action {value}");
            assert!(outcome.actions.iter().any(|action| matches!(action, AuthorityLogAction::Scheduler { command: SchedulerCommand::Schedule { timer } } if timer.delay_ms == safe(250) && timer.time_class == TimeClass::Connected && !timer.owner.owner_id.is_empty())), "seed={seed} timer metadata {value}");
            assert_eq!(log.head_revision(), revision(value), "seed={seed} monotonic head {value}");
            assert_eq!(log.retained().len(), value as usize, "seed={seed} retained count {value}");
        }

        let overflow = log.commit(draft(
            &authority,
            &format!("overflow-{seed}"),
            AuthorityEntryKind::TurnCommit,
            json!({"epoch": 3, "wave": 4, "turn": 1}),
            command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
        )?);
        assert!(matches!(overflow, Err(er_protocol::AuthorityLogError::RetentionOverflow { attempted_revision, .. }) if attempted_revision == revision(capacity + 1)), "seed={seed} capacity overflow");
        assert_eq!(log.head_revision(), revision(capacity), "seed={seed} capacity burned revision");
        assert_eq!(log.diagnostics().capacity_refusals, safe(1), "seed={seed} capacity refusal count");
        let slice = log.recovery_slice(Revision::ZERO);
        assert!(slice.is_some(), "seed={seed} dense recovery slice");
        let slice = slice.unwrap_or_else(|| AuthorityRecoverySlice {
            frontier: Revision::ZERO,
            frontier_operation_id: None,
            next_control: None,
            required_tail: Vec::new(),
        });
        assert_eq!(slice.required_tail.len(), capacity as usize, "seed={seed} recovery tail length");
        assert_eq!(slice.required_tail.first().map(|entry| entry.revision), Some(revision(1)), "seed={seed} recovery tail start");
        assert_eq!(slice.required_tail.last().map(|entry| entry.revision), Some(revision(capacity)), "seed={seed} recovery tail end");
        let equal = log.recovery_slice(revision(capacity));
        assert!(equal.is_some(), "seed={seed} equal frontier recovery proof");
        assert_eq!(equal.as_ref().map(|slice| slice.required_tail.len()), Some(1), "seed={seed} equal frontier reconstruction");
        let _ = log.dispose("property teardown");
        assert!(log.diagnostics().disposed, "seed={seed} disposed log");
        assert!(log.retained().is_empty(), "seed={seed} retained entries after disposal");
        assert_eq!(log.dispose("duplicate"), Vec::new(), "seed={seed} disposal idempotence");
    }

    let mut log = authority_log(4, &[(1, 4), (2, 4)])?;
    let authority = authority_context()?;
    let entry = log.commit(draft(
        &authority,
        "receipt-operation",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 3, "wave": 4, "turn": 1}),
        command_control(3, 4, 1, vec![command_target(0, 0, 7)]),
    )?)?.entry;
    let control_id = control_id_of(&entry.next_control);

    let admitted = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::Admitted, None)?);
    assert!(matches!(admitted.verdict, AuthorityReceiptVerdict::Advanced { retired: false, .. }));
    let duplicate = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::Admitted, None)?);
    assert!(matches!(duplicate.verdict, AuthorityReceiptVerdict::Duplicate { highest_stage: AckStage::Admitted }));
    let before_mechanical = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::PresentationSettled, None)?);
    assert!(matches!(before_mechanical.verdict, AuthorityReceiptVerdict::Rejected { reason: ReceiptRejectReason::PresentationBeforeMechanical }));
    let material = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::MaterialApplied, None)?);
    assert!(matches!(material.verdict, AuthorityReceiptVerdict::Advanced { retired: false, .. }));
    let wrong_control = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::ControlInstalled, Some("wrong".to_owned()))?);
    assert!(matches!(wrong_control.verdict, AuthorityReceiptVerdict::Rejected { reason: ReceiptRejectReason::ControlIdMismatch }));
    let installed_one = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::ControlInstalled, Some(control_id.clone()))?);
    assert!(matches!(installed_one.verdict, AuthorityReceiptVerdict::Advanced { retired: false, .. }));
    let settled_one = log.accept_receipt_detailed(receipt_for(&entry, 1, 4, AckStage::PresentationSettled, None)?);
    assert!(matches!(settled_one.verdict, AuthorityReceiptVerdict::Advanced { retired: false, .. }));
    let self_signed = log.accept_receipt_detailed(receipt_for(&entry, 0, 1, AckStage::Admitted, None)?);
    assert!(matches!(self_signed.verdict, AuthorityReceiptVerdict::Rejected { reason: ReceiptRejectReason::SelfSigned | ReceiptRejectReason::AuthoritySigned }));
    let admitted_two = log.accept_receipt_detailed(receipt_for(&entry, 2, 4, AckStage::Admitted, None)?);
    assert!(matches!(admitted_two.verdict, AuthorityReceiptVerdict::Advanced { retired: false, .. }));
    let material_two = log.accept_receipt_detailed(receipt_for(&entry, 2, 4, AckStage::MaterialApplied, None)?);
    assert!(matches!(material_two.verdict, AuthorityReceiptVerdict::Advanced { retired: false, .. }));
    let installed_two = log.accept_receipt_detailed(receipt_for(&entry, 2, 4, AckStage::ControlInstalled, Some(control_id))?);
    assert!(matches!(installed_two.verdict, AuthorityReceiptVerdict::Advanced { retired: true, .. }));
    assert!(log.retained().is_empty());
    assert!(log.peer_stage_quorum(&entry.operation_id, AckStage::ControlInstalled));
    assert!(log.diagnostics().delivery_timer_ids.is_empty());
    Ok(())
}

#[test]
fn replica_seeded_pipeline_has_one_incomplete_entry_and_monotonic_frontiers() -> TestResult {
    for seed in 0..10_u64 {
        let mut replica = replica()?;
        let first = replica_entry(1, &format!("replica-{seed}-1"))?;
        let admitted = replica.admit(first.clone());
        assert!(matches!(admitted.admission, ReplicaAdmission::Admitted { resume: ReplicaResume::Admitted }), "seed={seed} first admission");
        assert!(admitted.actions.iter().any(|action| matches!(action, ReplicaAction::ApplyMaterial { .. })), "seed={seed} first material action");
        assert_eq!(replica.frontier(), AuthorityFrontier { received: revision(1), material: Revision::ZERO, control: Revision::ZERO }, "seed={seed} admitted frontier");
        assert_replica_frontier_invariants(&replica, seed, "admitted");

        let duplicate = replica.admit(first.clone());
        assert!(matches!(duplicate.admission, ReplicaAdmission::Duplicate { resume: ReplicaResume::Admitted }), "seed={seed} material retry classification");
        assert!(duplicate.actions.iter().any(|action| matches!(action, ReplicaAction::ApplyMaterial { .. })), "seed={seed} material retry action");
        assert_replica_frontier_invariants(&replica, seed, "duplicate-material");
        assert!(replica.material_result(revision(1), MaterialApplicationOutcome::Deferred)?.is_empty(), "seed={seed} deferred material has no receipt");
        assert_replica_frontier_invariants(&replica, seed, "material-deferred");
        let material = replica.material_result(revision(1), MaterialApplicationOutcome::Applied)?;
        assert_eq!(replica.frontier(), AuthorityFrontier { received: revision(1), material: revision(1), control: Revision::ZERO }, "seed={seed} material frontier");
        assert!(material.iter().any(|action| matches!(action, ReplicaAction::ProjectControl { .. })), "seed={seed} control projection action");
        assert_replica_frontier_invariants(&replica, seed, "material-applied");

        let duplicate_control = replica.admit(first.clone());
        assert!(matches!(duplicate_control.admission, ReplicaAdmission::Duplicate { resume: ReplicaResume::MaterialApplied }), "seed={seed} control retry classification");
        assert!(!duplicate_control.actions.iter().any(|action| matches!(action, ReplicaAction::ApplyMaterial { .. })), "seed={seed} material reapplied after material stage");
        assert_replica_frontier_invariants(&replica, seed, "duplicate-control");
        assert!(replica.control_result(revision(1), ControlProjectionOutcome::Deferred)?.is_empty(), "seed={seed} deferred control has no receipt");
        assert_replica_frontier_invariants(&replica, seed, "control-deferred");
        let control_id = control_id_of(&first.next_control);
        let installed = replica.control_result(revision(1), ControlProjectionOutcome::Installed { control_id: control_id.clone() })?;
        assert!(installed.iter().any(|action| matches!(action, ReplicaAction::EmitReceipt { receipt } if receipt.stage == AckStage::ControlInstalled && receipt.control_id.as_deref() == Some(control_id.as_str()))), "seed={seed} control receipt");
        assert_eq!(replica.frontier(), AuthorityFrontier { received: revision(1), material: revision(1), control: revision(1) }, "seed={seed} complete frontier");
        assert!(replica.pending_entry().is_none(), "seed={seed} pending entry after control");
        assert_replica_frontier_invariants(&replica, seed, "control-installed");

        let second = replica_entry(2, &format!("replica-{seed}-2"))?;
        assert!(matches!(replica.admit(second.clone()).admission, ReplicaAdmission::Admitted { .. }), "seed={seed} second admission");
        assert_replica_frontier_invariants(&replica, seed, "second-admitted");
        let conflict = replica_entry(2, &format!("replica-{seed}-conflict"))?;
        assert!(matches!(replica.admit(conflict).admission, ReplicaAdmission::Rejected { reason: ReplicaRejectReason::RevisionIdentityConflict }), "seed={seed} same-revision conflict");
        let blocked = replica.admit(replica_entry(3, &format!("replica-{seed}-3"))?);
        assert!(matches!(blocked.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(2)), "seed={seed} N+1 blocked before N material/control");
        assert_replica_frontier_invariants(&replica, seed, "gap-before-material");
        replica.material_result(revision(2), MaterialApplicationOutcome::Applied)?;
        assert_replica_frontier_invariants(&replica, seed, "second-material-applied");
        let still_blocked = replica.admit(replica_entry(3, &format!("replica-{seed}-3b"))?);
        assert!(matches!(still_blocked.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(2)), "seed={seed} N+1 blocked while N control pending");
        assert_replica_frontier_invariants(&replica, seed, "gap-before-control");
        replica.control_result(revision(2), ControlProjectionOutcome::Installed { control_id: control_id_of(&second.next_control) })?;
        assert!(matches!(replica.admit(replica_entry(3, &format!("replica-{seed}-3c"))?).admission, ReplicaAdmission::Admitted { .. }), "seed={seed} successor unblocked after control");
        assert_replica_frontier_invariants(&replica, seed, "third-admitted");

        let frontier = replica.frontier();
        assert!(frontier.received >= frontier.material && frontier.material >= frontier.control, "seed={seed} frontier ordering");
        assert!(replica.diagnostics().pending_revision.is_none() || replica.diagnostics().pending_revision <= Some(frontier.received), "seed={seed} pending frontier bound");
        replica.dispose("seed teardown");
        assert!(replica.diagnostics().disposed, "seed={seed} disposed replica");
        assert!(replica.pending_entry().is_none(), "seed={seed} pending entry after disposal");
    }

    let mut fresh = replica()?;
    assert!(fresh.material_result(revision(1), MaterialApplicationOutcome::Applied).is_err());
    assert_eq!(fresh.frontier(), AuthorityFrontier::default());
    assert_replica_frontier_invariants(&fresh, 10, "fresh");
    let gap = fresh.admit(replica_entry(3, "gap-3")?);
    assert!(matches!(gap.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(1)));
    assert_eq!(gap.actions.iter().filter(|action| matches!(action, ReplicaAction::RequestTail { .. })).count(), 1);
    assert_replica_frontier_invariants(&fresh, 10, "gap-requested");
    let coalesced = fresh.admit(replica_entry(4, "gap-4")?);
    assert!(matches!(coalesced.admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(1)));
    assert!(coalesced.actions.is_empty());
    assert_replica_frontier_invariants(&fresh, 10, "gap-coalesced");

    let mut recovered = replica()?;
    let recovered_entry = replica_entry(7, "recovered-7")?;
    recovered.adopt_frontier(revision(7), Some(RecoveredFrontierTerminal {
        operation_id: recovered_entry.operation_id.clone(),
        next_control: recovered_entry.next_control.clone(),
    }))?;
    assert!(recovered.frontier().received >= recovered.frontier().material);
    assert_replica_frontier_invariants(&recovered, 11, "recovery-adopted");
    let stage_actions = recovered.stage_recovered_frontier(recovered_entry.clone())?;
    assert!(stage_actions.iter().any(|action| matches!(action, ReplicaAction::ProjectControl { .. })));
    assert_eq!(recovered.frontier().received, revision(7));
    assert_eq!(recovered.frontier().material, revision(7));
    assert_eq!(recovered.frontier().control, revision(6));
    assert_eq!(recovered.pending_entry().map(|entry| entry.revision), Some(revision(7)));
    assert_replica_frontier_invariants(&recovered, 11, "recovery-staged");
    assert!(matches!(recovered.admit(replica_entry(8, "recovered-8")?).admission, ReplicaAdmission::Gap { missing_from } if missing_from == revision(7)));
    recovered.control_result(revision(7), ControlProjectionOutcome::Installed { control_id: control_id_of(&recovered_entry.next_control) })?;
    assert_eq!(recovered.control_installed_through(), revision(7));
    assert_replica_frontier_invariants(&recovered, 11, "recovery-installed");
    Ok(())
}

#[test]
fn proposal_seeded_generators_preserve_fingerprints_dedup_conflicts_and_tombstones() -> TestResult {
    let wire = ProposalJson::new(r#" { "z": 1, "a": { "second": 2, "first": 1 } } "#)?;
    let reward_surface = ProposalJson::new(r#"{"surfaceId":"modifier:me:graves:0","ordinal":0}"#)?;
    let expected = r#"[42,"reward",-3,{"z":1,"a":{"second":2,"first":1}},{"surfaceId":"modifier:me:graves:0","ordinal":0}]"#;
    assert_eq!(fingerprint_reward(safe(42), "reward", signed(-3), Some(&wire), Some(&reward_surface))?, expected);
    assert_eq!(proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(42),
        label: "reward".to_owned(),
        choice: signed(-3),
        wire: Some(wire),
        reward_surface: Some(reward_surface),
    })?, expected);
    assert_eq!(fingerprint_biome_shop_leave(safe(12))?, r#"[7000012,"biomeShop",-1,null,null]"#);
    assert_eq!(fingerprint_biome_shop_buy(safe(12), signed(3), [signed(-4), signed(5), signed(6), signed(7)])?, r#"[7000012,"biomeShop",3,[-4,5,6,7],null]"#);
    let outcome = ProposalJson::new(r#"{"offer":{"z":1,"a":2},"accepted":true}"#)?;
    assert_eq!(fingerprint_bargain(safe(12), &outcome)?, r#"[7500012,"bargain",{"offer":{"z":1,"a":2},"accepted":true}]"#);
    assert_eq!(fingerprint_bargain(SafeU53::MAX, &ProposalJson::new("null")?), Err(er_protocol::ProposalFingerprintError::SequenceOverflow));
    assert_eq!(fingerprint_reward(safe(1), "", signed(0), None, None), Err(er_protocol::ProposalFingerprintError::EmptyKind));

    for seed in 0..12_u64 {
        let mut ledger = ProposalAdmissionLedger::new(safe(3))?;
        for ordinal in 0..3_u64 {
            let proposal = ProposalIdentity {
                operation_id: operation(&format!("proposal-{seed}-{ordinal}"))?,
                fingerprint: format!("fingerprint-{}", (seed + ordinal) % 4),
            };
            assert_eq!(ledger.admit(&proposal), ProposalAdmission::Admitted, "seed={seed} ordinal={ordinal} admission");
            assert_eq!(ledger.admit(&proposal), ProposalAdmission::Duplicate, "seed={seed} ordinal={ordinal} duplicate");
            assert_eq!(ledger.fingerprint(&proposal.operation_id), Some(proposal.fingerprint.as_str()), "seed={seed} ordinal={ordinal} fingerprint");
            let conflict = ProposalIdentity {
                operation_id: proposal.operation_id.clone(),
                fingerprint: format!("conflict-{seed}-{ordinal}"),
            };
            assert_eq!(ledger.admit(&conflict), ProposalAdmission::Conflict, "seed={seed} ordinal={ordinal} conflict");
        }
        let full = ProposalIdentity {
            operation_id: operation(&format!("proposal-{seed}-full"))?,
            fingerprint: "new".to_owned(),
        };
        assert_eq!(ledger.admit(&full), ProposalAdmission::CapacityExhausted, "seed={seed} capacity");
        assert_eq!(ledger.len(), safe(3), "seed={seed} non-evicting capacity");
        assert!(ledger.fingerprint(&operation(&format!("proposal-{seed}-0"))?).is_some(), "seed={seed} capacity retained original proposal");
        let invalid = ProposalIdentity {
            operation_id: operation(&format!("proposal-{seed}-invalid"))?,
            fingerprint: String::new(),
        };
        assert_eq!(ledger.admit(&invalid), ProposalAdmission::Invalid, "seed={seed} invalid proposal");
        ledger.reset();
        assert!(ledger.is_empty(), "seed={seed} reset");
        ledger.dispose();
        ledger.dispose();
        assert_eq!(ledger.admit(&full), ProposalAdmission::Invalid, "seed={seed} disposed admission");
        assert!(ledger.diagnostics().fingerprints.is_empty(), "seed={seed} disposed ledger fingerprints");
    }

    let config = ProposalLeaseConfig {
        owner_prefix: "authority-v2:proposal:".to_owned(),
        retry_initial_ms: safe(250),
        retry_maximum_ms: safe(5_000),
        absolute_ceiling_ms: safe(1_200_000),
    };
    let mut manager = ProposalLeaseManager::new(config.clone())?;
    let first = ProposalMessage {
        operation_id: operation("lease/first")?,
        fingerprint: "intent-a".to_owned(),
        from: seat(1),
        to: seat(2),
        connection_generation: generation(1),
        payload: Value::String("opaque".to_owned()),
    };
    let armed = manager.arm(ProposalLeaseSpec { proposal: first.clone(), absolute_ceiling_ms: Some(safe(1_000)) });
    assert_eq!(armed.result, ProposalLeaseStart::Retained);
    assert!(armed.actions.iter().any(|action| matches!(action, ProposalLeaseAction::Send { proposal } if proposal == &first)));
    let timer_ids = armed.actions.iter().filter_map(|action| match action {
        ProposalLeaseAction::Scheduler { command: SchedulerCommand::Schedule { timer } } => Some(timer.timer_id),
        _ => None,
    }).collect::<BTreeSet<_>>();
    assert_eq!(timer_ids.len(), 2);
    assert_eq!(manager.retained_count(), safe(1));
    let refreshed = manager.arm(ProposalLeaseSpec { proposal: first.clone(), absolute_ceiling_ms: Some(safe(1_000)) });
    assert_eq!(refreshed.result, ProposalLeaseStart::AlreadyRetained);
    assert!(refreshed.actions.iter().any(|action| matches!(action, ProposalLeaseAction::Send { proposal } if proposal == &first)));
    let conflict = ProposalMessage { fingerprint: "different".to_owned(), ..first.clone() };
    assert_eq!(manager.arm(ProposalLeaseSpec { proposal: conflict, absolute_ceiling_ms: None }).result, ProposalLeaseStart::Conflict);
    assert_eq!(manager.resend_retained().0, safe(1));
    let rebound = manager.rebind(seat(2), generation(2))?;
    assert_eq!(rebound.0, safe(1));
    assert!(rebound.1.iter().any(|action| matches!(action, ProposalLeaseAction::Send { proposal } if proposal.connection_generation == generation(2))));
    let mut retry_id = armed.actions.iter().find_map(|action| match action {
        ProposalLeaseAction::Scheduler { command: SchedulerCommand::Schedule { timer } }
            if timer.time_class == TimeClass::Connected => Some(timer.timer_id),
        _ => None,
    }).unwrap_or(TimerId::ZERO);
    for expected_delay in [500_u64, 1_000, 2_000, 4_000, 5_000] {
        let retry = manager.timer_fired(retry_id)?;
        assert!(retry.iter().any(|action| matches!(action, ProposalLeaseAction::Send { proposal } if proposal.operation_id == first.operation_id)), "retry send at {expected_delay}ms");
        retry_id = retry.iter().find_map(|action| match action {
            ProposalLeaseAction::Scheduler { command: SchedulerCommand::Schedule { timer } }
                if timer.time_class == TimeClass::Connected && timer.delay_ms == safe(expected_delay) => Some(timer.timer_id),
            _ => None,
        }).unwrap_or(TimerId::ZERO);
        assert_ne!(retry_id, TimerId::ZERO, "retry timer at {expected_delay}ms");
    }
    let absolute_id = armed.actions.iter().find_map(|action| match action {
        ProposalLeaseAction::Scheduler { command: SchedulerCommand::Schedule { timer } } if timer.time_class == TimeClass::Absolute => Some(timer.timer_id),
        _ => None,
    });
    assert!(absolute_id.is_some());
    let expiry = manager.timer_fired(absolute_id.unwrap_or(TimerId::ZERO))?;
    assert!(expiry.iter().any(|action| matches!(action, ProposalLeaseAction::Terminalize { operation_id, .. } if operation_id == &first.operation_id)));
    assert_eq!(manager.retained_count(), SafeU53::ZERO);
    assert!(manager.diagnostics().timer_ids.is_empty());

    let mut tombstones = ProposalLeaseManager::new(config)?;
    let committed = operation("lease/committed")?;
    assert_eq!(tombstones.observe_committed(&committed), (false, Vec::new()));
    let committed_proposal = ProposalMessage { operation_id: committed.clone(), ..first.clone() };
    assert_eq!(tombstones.arm(ProposalLeaseSpec { proposal: committed_proposal, absolute_ceiling_ms: None }).result, ProposalLeaseStart::AlreadyCommitted);
    let live = ProposalMessage { operation_id: operation("lease/live")?, ..first };
    assert_eq!(tombstones.arm(ProposalLeaseSpec { proposal: live.clone(), absolute_ceiling_ms: None }).result, ProposalLeaseStart::Retained);
    let settled = tombstones.observe_committed(&live.operation_id);
    assert!(settled.0);
    assert_eq!(tombstones.retained_count(), SafeU53::ZERO);
    assert_eq!(tombstones.arm(ProposalLeaseSpec { proposal: live, absolute_ceiling_ms: None }).result, ProposalLeaseStart::AlreadyCommitted);
    tombstones.dispose("property teardown");
    tombstones.dispose("duplicate");
    assert!(tombstones.diagnostics().committed_tombstones.is_empty());
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

fn known_frame_cases() -> [(&'static str, Value); 7] {
    [
        ("authorityEntry", valid_entry_body()),
        ("authorityReceipt", json!({"revision": 0, "operationId": "operation-1", "stage": "admitted"})),
        ("tailRequest", json!({"fromRevision": 0})),
        ("recoveryRequest", json!({"requestId": "request-1", "capturedFrontier": 0, "reason": "rejoin"})),
        ("recoveryBundle", json!({
            "requestId": "request-1",
            "material": valid_material_value(),
            "frontier": 0,
            "frontierOperationId": null,
            "membershipRevision": 2,
            "nextControl": null,
            "requiredTail": []
        })),
        ("recoveryApplied", json!({"requestId": "request-1", "frontier": 0, "materialDigest": "digest"})),
        ("terminal", json!({"terminalId": "terminal-1", "reason": "protocol"})),
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
                RawFrame::JsonText(serde_json::to_string(&value)?)
            };
            let result = catch_unwind(AssertUnwindSafe(|| validate_inbound_frame(&raw)));
            assert!(result.is_ok(), "seed={seed} step={step} validator panicked for {raw:?}");
            let result = result.unwrap_or(InboundFrameResult::ProtocolViolation { frame_type: None, issues: vec!["panic".to_owned()] });
            match result {
                InboundFrameResult::Valid { frame } => {
                    assert!(matches!(frame.frame.frame_type, FrameType::AuthorityEntry | FrameType::AuthorityReceipt | FrameType::TailRequest | FrameType::RecoveryRequest | FrameType::RecoveryBundle | FrameType::RecoveryApplied | FrameType::Terminal), "seed={seed} step={step} invalid valid frame tag");
                }
                InboundFrameResult::CosmeticDrop { reason } => assert!(!reason.is_empty(), "seed={seed} step={step} empty cosmetic reason"),
                InboundFrameResult::ProtocolViolation { issues, .. } => assert!(!issues.is_empty(), "seed={seed} step={step} empty protocol issue list"),
            }
        }
    }

    let malformed = validate_inbound_frame(&RawFrame::JsonText("{\"v\":2,\"t\":\"unknown\"".to_owned()));
    assert!(matches!(malformed, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["malformed JSON"]));
    let non_object = validate_inbound_frame(&RawFrame::JsonValue(json!([])));
    assert!(matches!(non_object, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["frame is not a JSON object"]));
    let version_precedence = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 1, "t": "futureCosmetic"})));
    assert!(matches!(version_precedence, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["unsupported frame protocol version: 1"]));
    let missing_version = validate_inbound_frame(&RawFrame::JsonValue(json!({"t": 17, "body": null})));
    assert!(matches!(missing_version, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["missing protocol version `v`"]));
    let missing_type = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 2, "body": null})));
    assert!(matches!(missing_type, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["frame type `t` is missing or not a string"]));
    let non_string_type = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 2, "t": {}})));
    assert!(matches!(non_string_type, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["frame type `t` is missing or not a string"]));
    let raw_version_precedence = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": "2", "t": "terminal"})));
    assert!(matches!(raw_version_precedence, InboundFrameResult::ProtocolViolation { frame_type: None, issues } if issues == vec!["unsupported frame protocol version: 2"]));
    let cosmetic = validate_inbound_frame(&RawFrame::JsonValue(json!({"v": 2, "t": "futureCosmetic", "ctx": null, "body": null})));
    assert!(matches!(cosmetic, InboundFrameResult::CosmeticDrop { reason } if reason == "unknown cosmetic frame type: futureCosmetic"));
    let known_malformed = validate_inbound_frame(&RawFrame::JsonValue(json!({
        "v": 2,
        "t": "tailRequest",
        "ctx": {},
        "body": null
    })));
    assert!(matches!(known_malformed, InboundFrameResult::ProtocolViolation { frame_type: Some(frame_type), issues } if frame_type == "tailRequest" && issues == vec![
        "ctx.sessionId", "ctx.runId", "ctx.sessionEpoch", "ctx.seatMapId", "ctx.membershipRevision", "ctx.senderSeatId", "ctx.authoritySeatId", "ctx.connectionGeneration", "body.not an object"
    ].into_iter().map(str::to_owned).collect::<Vec<_>>()));

    for (frame_type, body) in known_frame_cases() {
        let result = FrameValidator::new().validate(&RawFrame::JsonValue(raw_envelope(frame_type, body.clone())));
        assert!(matches!(result, InboundFrameResult::Valid { .. }), "known frame {frame_type} did not validate");
    }
    let mut missing_context = context_value();
    if let Some(object) = missing_context.as_object_mut() {
        object.remove("sessionId");
        object.remove("connectionGeneration");
    }
    let issues = frame_context_issues(&missing_context);
    assert_eq!(issues, vec!["sessionId".to_owned(), "connectionGeneration".to_owned()]);
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
fn successor_identity_is_stable_for_canonical_sets_and_sensitive_to_ordered_tails() -> TestResult {
    let command_a = command_control(1, 2, 3, vec![command_target(1, 1, 202), command_target(0, 0, 101)]);
    let command_b = command_control(1, 2, 3, vec![command_target(0, 0, 101), command_target(1, 1, 202)]);
    assert_eq!(control_id_of(&command_a), "COMMAND_FRONTIER/e1/w2/t3/f0:s0:p101,f1:s1:p202");
    assert_eq!(control_id_of(&command_a), control_id_of(&command_b));
    assert!(controls_equal(Some(&command_a), Some(&command_b)));
    assert!(same_control_address(&command_a, &command_b));

    let replacement = replacement_control("replacement/e1/w2/t3/o0/f0")?;
    assert_eq!(control_id_of(&replacement), "REPLACEMENT/replacement%2Fe1%2Fw2%2Ft3%2Fo0%2Ff0/s0/e1/w2/t3/o0/f0/remaining:replacement%2Ftail%2F1:s1:e1:w2:t3:o1:f1");
    let mut reversed = replacement.clone();
    if let NextControl::Replacement(control) = &mut reversed {
        control.remaining.reverse();
    }
    assert_ne!(control_id_of(&replacement), control_id_of(&reversed));

    let shared_a = shared_control("REWARD", Some(vec![operation("id/b")?, operation("id/a")?]))?;
    let shared_b = shared_control("REWARD", Some(vec![operation("id/a")?, operation("id/b")?]))?;
    assert_eq!(control_id_of(&shared_a), control_id_of(&shared_b));
    assert!(control_id_of(&shared_a).contains("resultIds:id%2Fa,id%2Fb"));
    let wildcard = shared_control("REWARD", None)?;
    assert!(control_id_of(&wildcard).ends_with("resultIds:*"));

    let wait = await_control()?;
    assert_eq!(control_id_of(&wait), "AWAIT_SUCCESSOR/predecessor/e1/w2/t3/CONTROL_COMMIT,INTERACTION_COMMIT,WAVE_ADVANCE,TERMINAL_COMMIT/interactionAddresses:*/controlAddresses:*/nextWave:1/next:*");
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
    assert!(issues.contains(&"epoch".to_owned()));
    assert!(issues.contains(&"commands[1].fieldIndex: duplicate".to_owned()));
    assert!(!is_valid_next_control(&invalid));
    let encoded = serde_json::to_value(command_a.clone())?;
    assert!(validate_next_control(&encoded).is_ok());
    assert!(is_valid_next_control(&encoded));
    assert_eq!(SuccessorValidator::new().validate(&encoded), Ok(command_a.clone()));

    let command_entry = authority_entry(
        &authority_context()?,
        1,
        "turn/accepted",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "wave": 2, "turn": 3}),
        command_a.clone(),
    )?;
    assert!(control_allows_successor_entry(&command_a, &operation("predecessor")?, &command_entry));
    let stale_entry = authority_entry(
        &authority_context()?,
        2,
        "turn/stale",
        AuthorityEntryKind::TurnCommit,
        json!({"epoch": 1, "wave": 2, "turn": 4}),
        command_a.clone(),
    )?;
    assert!(!control_allows_successor_entry(&command_a, &operation("predecessor")?, &stale_entry));

    let replacement_entry = authority_entry(
        &authority_context()?,
        1,
        "replacement/e1/w2/t3/o0/f0",
        AuthorityEntryKind::ReplacementCommit,
        json!({"sourceAddress": {"epoch": 1, "wave": 2, "turn": 3}}),
        replacement.clone(),
    )?;
    assert!(control_allows_successor_entry(&replacement, &operation("predecessor")?, &replacement_entry));

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
    assert!(control_allows_successor_entry(&shared_result, &operation("predecessor")?, &interaction_entry));

    let mut wait_value = match wait {
        NextControl::AwaitSuccessor(value) => value,
        _ => return Err("await helper returned another control".into()),
    };
    wait_value.allowed_kinds = vec![AuthorityEntryKind::ControlCommit, AuthorityEntryKind::InteractionCommit];
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
    assert!(successor_wait_allows_local_presentation_input(&wait_value, &proof));
    assert!(!successor_wait_allows_local_presentation_input(&wait_value, &er_protocol::LocalPresentationInputProof { phase_name: "MessagePhase".to_owned(), ..proof }));
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
            let bundle = recovered_bundle(captured, frontier)?;
            let verdict = er_protocol::validate_recovery_bundle(&recovery_validation_context(captured)?, &bundle);
            if frontier < captured {
                assert!(matches!(verdict, RecoveryBundleValidation::Stale { .. }), "captured={captured} frontier={frontier} stale classification");
            } else {
                assert!(matches!(verdict, RecoveryBundleValidation::Valid { .. }), "captured={captured} frontier={frontier} valid classification");
            }
        }
    }
    let mut invalid_zero = recovered_bundle(0, 0)?;
    invalid_zero.frontier_operation_id = Some(operation("unexpected")?);
    assert!(matches!(er_protocol::validate_recovery_bundle(&recovery_validation_context(0)?, &invalid_zero), RecoveryBundleValidation::Mismatch { .. }));
    let mut invalid_tail = recovered_bundle(2, 4)?;
    invalid_tail.required_tail[1].revision = revision(9);
    assert!(matches!(er_protocol::validate_recovery_bundle(&recovery_validation_context(2)?, &invalid_tail), RecoveryBundleValidation::Mismatch { .. }));
    let mut invalid_context = recovered_bundle(2, 4)?;
    invalid_context.context = replica_context()?;
    assert!(matches!(er_protocol::validate_recovery_bundle(&recovery_validation_context(2)?, &invalid_context), RecoveryBundleValidation::Mismatch { .. }));
    let mut invalid_request = recovered_bundle(2, 4)?;
    invalid_request.request_id = "other-request".to_owned();
    assert!(matches!(er_protocol::validate_recovery_bundle(&recovery_validation_context(2)?, &invalid_request), RecoveryBundleValidation::Mismatch { .. }));

    let mut out_of_order = recovery_transaction()?;
    assert!(matches!(
        out_of_order.material_result(RecoveryMaterialOutcome::Applied, authority_frontier(0), &replica_context()?),
        Err(RecoveryError::InvalidPhase { phase: None })
    ));
    let _ = out_of_order.start("recovery-1".to_owned(), authority_frontier(1), "phase-order".to_owned())?;
    assert!(matches!(
        out_of_order.control_result(ControlProjectionOutcome::Deferred),
        Err(RecoveryError::InvalidPhase { phase: Some(RecoveryPhase::Requested) })
    ));
    assert!(matches!(
        out_of_order.recovered_frontier_staged(revision(1)),
        Err(RecoveryError::InvalidPhase { phase: Some(RecoveryPhase::Requested) })
    ));
    assert!(matches!(
        out_of_order.start("again".to_owned(), authority_frontier(1), "duplicate".to_owned()),
        Err(RecoveryError::FenceHeld)
    ));
    assert!(matches!(
        out_of_order.timer_fired(TimerId::new(safe(99))),
        Err(RecoveryError::InvalidPhase { phase: Some(RecoveryPhase::Requested) })
    ));

    let mut stale = recovery_transaction()?;
    let _ = stale.start("recovery-1".to_owned(), authority_frontier(1), "stale".to_owned())?;
    assert!(matches!(
        stale.accept_bundle(recovered_bundle(1, 3)?, authority_frontier(2), &replica_context()?),
        Err(RecoveryError::StaleBundle)
    ));
    assert_eq!(stale.phase(), Some(RecoveryPhase::Terminalized));
    assert_eq!(stale.fence_view().map(|view| view.state), Some(RecoveryFenceState::Terminal));
    assert!(stale.diagnostics().timer_ids.is_empty());

    let mut wrong_control = recovery_transaction()?;
    let _ = wrong_control.start("recovery-1".to_owned(), authority_frontier(1), "wrong-control".to_owned())?;
    let _ = wrong_control.accept_bundle(recovered_bundle(1, 3)?, authority_frontier(1), &replica_context()?)?;
    let _ = wrong_control.material_result(RecoveryMaterialOutcome::Applied, authority_frontier(1), &replica_context()?)?;
    let _ = wrong_control.recovered_frontier_staged(revision(3))?;
    let wrong_actions = wrong_control.control_result(ControlProjectionOutcome::Installed {
        control_id: "wrong-control-id".to_owned(),
    })?;
    assert_eq!(wrong_control.phase(), Some(RecoveryPhase::Terminalized));
    assert_eq!(wrong_control.fence_view().map(|view| view.state), Some(RecoveryFenceState::Terminal));
    assert!(wrong_actions.iter().all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. })));

    let mut happy = recovery_transaction()?;
    let start = happy.start("recovery-1".to_owned(), authority_frontier(1), "rejoin".to_owned())?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::Requested));
    assert_eq!(happy.fence_view().map(|view| view.state), Some(RecoveryFenceState::Held));
    let request_timer = scheduled_timer_from(&start, safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS));
    assert!(request_timer.is_some());
    assert!(matches!(start.last(), Some(RecoveryAction::SendRequest { request }) if request.request_id == "recovery-1" && request.captured_frontier == revision(1)));
    assert_eq!(happy.accept_bundle(recovered_bundle(1, 3)?, authority_frontier(1), &replica_context()?).is_ok(), true);
    assert_eq!(happy.phase(), Some(RecoveryPhase::Validated));
    let material = happy.material_result(RecoveryMaterialOutcome::Applied, authority_frontier(1), &replica_context()?)?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::MaterialApplied));
    assert!(material.iter().any(|action| matches!(action, RecoveryAction::StageRecoveredFrontier { entry } if entry.revision == revision(3))));
    let staged = happy.recovered_frontier_staged(revision(3))?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::FrontierInstalled));
    assert!(happy.fence_view().is_some_and(|view| !view.control_surface_start_frozen && !view.authority_wait_creation_frozen));
    let installed = happy.control_result(ControlProjectionOutcome::Installed { control_id: control_id_of(&recovered_bundle(1, 3)?.next_control.unwrap_or_else(|| terminal_control("missing"))) })?;
    assert_eq!(happy.phase(), Some(RecoveryPhase::Released));
    assert_eq!(happy.fence_view().map(|view| view.state), Some(RecoveryFenceState::Open));
    assert!(installed.iter().any(|action| matches!(action, RecoveryAction::SendAppliedProof { proof } if proof.control_id.is_some())));
    assert!(happy.diagnostics().timer_ids.is_empty());
    assert!(scheduled_timer_from(&staged, safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS)).is_some());

    let mut zero = recovery_transaction()?;
    zero.start("recovery-1".to_owned(), authority_frontier(0), "empty".to_owned())?;
    zero.accept_bundle(recovered_bundle(0, 0)?, authority_frontier(0), &replica_context()?)?;
    let zero_actions = zero.material_result(RecoveryMaterialOutcome::Applied, authority_frontier(0), &replica_context()?)?;
    assert_eq!(zero.phase(), Some(RecoveryPhase::Released));
    assert!(zero_actions.iter().all(|action| !matches!(action, RecoveryAction::StageRecoveredFrontier { .. } | RecoveryAction::ProjectControl { .. })));
    assert!(zero_actions.iter().any(|action| matches!(action, RecoveryAction::SendAppliedProof { proof } if proof.control_id.is_none())));

    for outcome in [RecoveryMaterialOutcome::Deferred, RecoveryMaterialOutcome::Rejected] {
        let mut failed = recovery_transaction()?;
        failed.start("recovery-1".to_owned(), authority_frontier(1), "failure".to_owned())?;
        failed.accept_bundle(recovered_bundle(1, 3)?, authority_frontier(1), &replica_context()?)?;
        let actions = failed.material_result(outcome, authority_frontier(1), &replica_context()?)?;
        assert_eq!(failed.phase(), Some(RecoveryPhase::Terminalized));
        assert!(failed.fence_view().is_some_and(|view| view.state == RecoveryFenceState::Terminal));
        assert!(actions.iter().all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. })));
    }

    let mut timeout = recovery_transaction()?;
    let timeout_start = timeout.start("recovery-1".to_owned(), authority_frontier(1), "timeout".to_owned())?;
    let timeout_id = scheduled_timer_from(&timeout_start, safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS)).unwrap_or(TimerId::ZERO);
    let timeout_actions = timeout.timer_fired(timeout_id)?;
    assert_eq!(timeout.phase(), Some(RecoveryPhase::Terminalized));
    assert!(timeout.fence_view().is_some_and(|view| view.state == RecoveryFenceState::Terminal));
    assert!(timeout_actions.iter().all(|action| !matches!(action, RecoveryAction::SendAppliedProof { .. })));
    assert!(timeout.diagnostics().timer_ids.is_empty());

    let mut aborted = recovery_transaction()?;
    aborted.start("recovery-1".to_owned(), authority_frontier(1), "abort".to_owned())?;
    let first_abort = aborted.abort("operator cancellation".to_owned());
    assert!(first_abort.iter().any(|action| matches!(action, RecoveryAction::Terminalize { reason } if reason == "operator cancellation")));
    assert!(aborted.abort("second cancellation".to_owned()).is_empty());
    assert!(matches!(aborted.start("again".to_owned(), authority_frontier(0), "again".to_owned()), Err(RecoveryError::Terminalized { .. })));
    Ok(())
}
