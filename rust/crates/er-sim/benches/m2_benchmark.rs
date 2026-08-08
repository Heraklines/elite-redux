use std::collections::BTreeMap;
use std::error::Error;
use std::io::{self, Write};

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, GameKernel, KernelConfig, KernelEffect, KernelInput,
    MenuProposalPlan, ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, FrameValidator,
    PeerBinding, ProposalFingerprintInput, ProposalJson, ProposalLeaseConfig,
    RecoveryTransactionConfig, control_id_of, proposal_fingerprint,
};
use er_sim::{
    FaultNetwork, FaultOperation, FrameCorruption, NetworkEvent, PairEndpoint, PairOperation,
    PairStep, PresenterMode, SimulatedPair, SimulatedPairConfig,
};
use er_types::{
    AuthorityEntryKind, CancelPolicy, CommandControlTarget, CommandFrontierControl,
    ConnectionGeneration, FrameContext, FrameType, GameButton, InputFocus, InputMap, KeyBinding,
    Material, MembershipRevision, MenuGeneration, MenuOption, MenuOptionId, MenuState,
    NetworkPayload, NextControl, OperationId, PhysicalKey, RawFrame, RawInputEvent, SafeI53,
    SafeU53, SeatId, SessionId, TimeClass, UiIntent, UiState, UiViewKind,
};
use serde::Serialize;
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const INPUT_SEED: &str = "1469598103934665603";
const PROPOSAL_SEED: &str = "1099511628211";
const FAULT_SEED: &str = "16045690984833335023";
const CAMPAIGN_SEED: &str = "81985529216486895";

const INPUT_TRANSITIONS: u64 = 1_000;
const PROPOSAL_CYCLES: u64 = 1_000;
const FAULT_SCHEDULES: u64 = 10_000;
const CAMPAIGN_STEPS: u64 = 100_000;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn operation(value: impl Into<String>) -> TestResult<OperationId> {
    Ok(OperationId::new(value.into())?)
}

fn menu_option(value: impl Into<String>) -> TestResult<MenuOption> {
    let value = value.into();
    Ok(MenuOption {
        id: MenuOptionId::new(value.clone())?,
        label_key: format!("benchmark.{value}"),
        enabled: true,
        visible: true,
    })
}

fn input_map() -> InputMap {
    InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowUp,
                button: GameButton::Up,
            },
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Enter,
                button: GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    }
}

fn checksum_bytes(checksum: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *checksum ^= u64::from(*byte);
        *checksum = checksum.wrapping_mul(FNV_PRIME);
    }
}

fn absorb<T: Serialize>(checksum: &mut u64, value: &T) -> TestResult {
    checksum_bytes(checksum, &serde_json::to_vec(value)?);
    Ok(())
}

fn report(
    scenario_id: &str,
    seed: &str,
    iterations: u64,
    schedules: u64,
    steps: u64,
    checksum: u64,
    details: Value,
) -> TestResult {
    assert_ne!(checksum, FNV_OFFSET, "benchmark checksum must include work");
    let marker = json!({
        "scenario_id": scenario_id,
        "seed": seed,
        "iterations": iterations,
        "schedules": schedules,
        "steps": steps,
        "checksum": format!("{checksum:016x}"),
        "success": true,
        "details": details,
    });
    let mut stdout = io::stdout().lock();
    writeln!(
        stdout,
        "M2_BENCHMARK_RESULT {}",
        serde_json::to_string(&marker)?
    )?;
    stdout.flush()?;
    Ok(())
}

fn choice_menu(owner: SeatId) -> TestResult<UiState> {
    Ok(UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: Some(owner),
        actionable: true,
        stack: vec![MenuState::ChoiceList(er_types::ChoiceListMenu {
            cursor: SafeU53::ZERO,
            page: SafeU53::ZERO,
            wrap: true,
            options: vec![menu_option("up")?, menu_option("down")?],
            cancel: CancelPolicy::Disabled,
        })],
    })
}

fn input_kernel() -> TestResult<GameKernel> {
    Ok(GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui: choice_menu(seat(1))?,
        protocol: None,
    }))
}

#[test]
fn m2_raw_input_menu_transitions() -> TestResult {
    let mut kernel = input_kernel()?;
    let owner = seat(1);
    let mut checksum = FNV_OFFSET;
    let mut raw_input_events = 0_u64;

    for index in 0..INPUT_TRANSITIONS {
        let code = if index % 2 == 0 {
            PhysicalKey::ArrowDown
        } else {
            PhysicalKey::ArrowUp
        };
        let pressed = kernel.step(KernelInput::RawInput {
            seat: owner,
            event: RawInputEvent::KeyDown {
                code: code.clone(),
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        })?;
        assert!(pressed.iter().any(|effect| {
            matches!(
                effect,
                KernelEffect::UiChanged { .. } | KernelEffect::UiIntent { .. }
            )
        }));
        absorb(&mut checksum, &pressed)?;
        raw_input_events += 1;

        let released = kernel.step(KernelInput::RawInput {
            seat: owner,
            event: RawInputEvent::KeyUp { code },
        })?;
        absorb(&mut checksum, &released)?;
        raw_input_events += 1;
        absorb(&mut checksum, &kernel.snapshot())?;
    }

    assert_eq!(raw_input_events, INPUT_TRANSITIONS * 2);
    let state_digest = kernel.state_digest();
    absorb(&mut checksum, &state_digest)?;
    let disposed_effects = kernel.dispose("m2 benchmark input teardown");
    absorb(&mut checksum, &disposed_effects)?;
    assert!(kernel.is_disposed());
    assert!(kernel.live_resources().timers.is_empty());

    report(
        "raw-input-menu-transitions",
        INPUT_SEED,
        INPUT_TRANSITIONS,
        0,
        0,
        checksum,
        json!({
            "raw_input_events": raw_input_events,
            "final_state_digest": state_digest,
        }),
    )
}

fn benchmark_context(sender_seat_id: u64) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m2-benchmark-session")?,
        run_id: er_types::RunId::new("m2-benchmark-run")?,
        session_epoch: safe(1),
        seat_map_id: "m2-benchmark-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(0),
        connection_generation: ConnectionGeneration::ZERO,
    })
}

fn command_control(field_index: u64) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        commands: vec![
            CommandControlTarget {
                owner_seat_id: seat(1),
                pokemon_id: safe(42),
                field_index: safe(field_index),
            },
            CommandControlTarget {
                owner_seat_id: seat(0),
                pokemon_id: safe(99),
                field_index: safe(field_index + 1),
            },
        ],
    })
}

fn command_menu(
    owner_seat_id: SeatId,
    operation_id: OperationId,
    control_id: String,
    option: MenuOption,
) -> UiState {
    UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: Some(owner_seat_id),
        actionable: true,
        stack: vec![MenuState::Command(er_types::CommandMenu {
            operation_id,
            control_id,
            cursor: SafeU53::ZERO,
            options: vec![option],
            cancel: CancelPolicy::Disabled,
        })],
    }
}

fn command_plan(
    index: u64,
    owner_seat_id: SeatId,
    field_index: u64,
    control_id: String,
    operation_id: OperationId,
    option: MenuOption,
    fingerprint: String,
) -> ControlMenuPlan {
    let option_id = option.id.clone();
    ControlMenuPlan::Command {
        control_id,
        owner_seat_id,
        operation_id,
        field_index: safe(field_index),
        options: vec![option],
        proposals: vec![MenuProposalPlan {
            option_id,
            fingerprint,
            payload: json!({"choice": index}),
        }],
        cancel: CancelPolicy::Disabled,
    }
}

fn benchmark_proposal_fingerprint(index: u64) -> TestResult<String> {
    let wire = ProposalJson::new(format!(r#"{{"choice":{index}}}"#))?;
    Ok(proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(index + 1),
        label: "turnCommand".to_owned(),
        choice: SafeI53::ZERO,
        wire: Some(wire),
        reward_surface: None,
    })?)
}

fn authority_resolution(
    index: u64,
    operation_id: OperationId,
    fingerprint: String,
    next_control: NextControl,
) -> TestResult<AuthorityResolutionPlan> {
    Ok(AuthorityResolutionPlan {
        operation_id: operation_id.clone(),
        fingerprint,
        draft: AuthorityEntryDraft {
            context: benchmark_context(0)?,
            operation_id,
            kind: AuthorityEntryKind::TurnCommit,
            material: Material {
                digest: format!("m2-benchmark-digest-{index}"),
                payload: json!({
                    "epoch": 1,
                    "wave": 1,
                    "turn": 1,
                    "fieldIndex": index,
                    "choice": index,
                }),
            },
            next_control,
            subsumes: Vec::new(),
        },
    })
}

fn authority_log_config() -> TestResult<AuthorityLogConfig> {
    Ok(AuthorityLogConfig {
        local_context: benchmark_context(0)?,
        peer_bindings: vec![PeerBinding {
            seat_id: seat(1),
            connection_generation: ConnectionGeneration::ZERO,
        }],
        owner_id: "m2-benchmark-authority".to_owned(),
        retain_capacity: safe(PROPOSAL_CYCLES + 4),
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250),
            maximum_ms: safe(5_000),
            factor_numerator: safe(2),
            factor_denominator: safe(1),
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: Some(safe(8)),
    })
}

fn proposal_lease_config() -> ProposalLeaseConfig {
    ProposalLeaseConfig {
        owner_prefix: "m2-benchmark:proposal:".to_owned(),
        retry_initial_ms: safe(250),
        retry_maximum_ms: safe(5_000),
        absolute_ceiling_ms: safe(1_200_000),
    }
}

fn recovery_config() -> TestResult<RecoveryTransactionConfig> {
    Ok(RecoveryTransactionConfig {
        local_context: benchmark_context(1)?,
        request_timeout_ms: safe(300_000),
        control_timeout_ms: safe(30_000),
        pacing_ms: safe(16),
        timer_owner_id: "m2-benchmark:recovery".to_owned(),
    })
}

fn protocol_pair(seed: u64) -> TestResult<SimulatedPair> {
    assert_eq!(
        benchmark_proposal_fingerprint(0)?,
        r#"[1,"turnCommand",0,{"choice":0},null]"#,
    );
    assert_eq!(
        benchmark_proposal_fingerprint(PROPOSAL_CYCLES)?,
        r#"[1001,"turnCommand",0,{"choice":1000},null]"#,
    );

    let mut menu_plans = Vec::with_capacity(((PROPOSAL_CYCLES + 1) * 2) as usize);
    let mut resolutions = Vec::with_capacity(PROPOSAL_CYCLES as usize);
    for index in 0..=PROPOSAL_CYCLES {
        let guest_option = menu_option(format!("choice/{index}"))?;
        let host_option = guest_option.clone();
        let operation_id = operation(format!("turn/benchmark/{index}"))?;
        let control = command_control(index);
        let control_id = control_id_of(&control);
        let fingerprint = benchmark_proposal_fingerprint(index)?;
        menu_plans.push(command_plan(
            index,
            seat(1),
            index,
            control_id.clone(),
            operation_id.clone(),
            guest_option,
            fingerprint.clone(),
        ));
        menu_plans.push(command_plan(
            index,
            seat(0),
            index + 1,
            control_id,
            operation_id.clone(),
            host_option,
            fingerprint.clone(),
        ));
        if index < PROPOSAL_CYCLES {
            resolutions.push(authority_resolution(
                index,
                operation_id,
                fingerprint,
                command_control(index + 1),
            )?);
        }
    }

    let initial_control_id = control_id_of(&command_control(0));
    let initial_operation_id = operation("turn/benchmark/0")?;
    let initial_option = menu_option("choice/0")?;
    let host_initial_ui = command_menu(
        seat(1),
        initial_operation_id.clone(),
        initial_control_id.clone(),
        initial_option.clone(),
    );
    let guest_initial_ui = command_menu(
        seat(1),
        initial_operation_id,
        initial_control_id,
        initial_option,
    );
    let menu_plans_for_guest = menu_plans.clone();

    let host_kernel = KernelConfig {
        input_map: input_map(),
        initial_ui: host_initial_ui,
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: authority_log_config()?,
                proposal_capacity: safe(8_192),
                resolutions,
            },
            menu_plans,
        }),
    };
    let guest_kernel = KernelConfig {
        input_map: input_map(),
        initial_ui: guest_initial_ui,
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: benchmark_context(1)?,
                    authority_seat_id: seat(0),
                    authority_connection_generation: ConnectionGeneration::ZERO,
                },
                proposal_leases: proposal_lease_config(),
                recovery: recovery_config()?,
            },
            menu_plans: menu_plans_for_guest,
        }),
    };

    Ok(SimulatedPair::new(SimulatedPairConfig {
        host_kernel,
        guest_kernel,
        host_seat: seat(0),
        guest_seat: seat(1),
        seed,
        presenter: PresenterMode::Instant,
        initial_storage: BTreeMap::new(),
        event_budget: safe(4_096),
    })?)
}

#[derive(Default)]
struct CycleEvidence {
    command_submitted: bool,
    proposal_sent: bool,
    authority_entry_sent: bool,
    material_applied: bool,
    control_projected: bool,
    receipts_sent: usize,
}

fn observe_cycle_step(
    step: &PairStep,
    operation_id: &OperationId,
    evidence: &mut CycleEvidence,
    checksum: &mut u64,
) -> TestResult {
    absorb(checksum, &step.generated_effects)?;
    absorb(checksum, &step.effects_digest)?;
    absorb(checksum, &step.snapshot)?;
    for effect in &step.generated_effects {
        match effect {
            KernelEffect::UiIntent {
                endpoint,
                intent:
                    UiIntent::CommandSubmitted {
                        operation_id: submitted_operation,
                        ..
                    },
            } if *endpoint == seat(1) && submitted_operation == operation_id => {
                evidence.command_submitted = true;
            }
            KernelEffect::SendProposal { proposal } if proposal.operation_id == *operation_id => {
                evidence.proposal_sent = true;
            }
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::AuthorityEntry =>
            {
                evidence.authority_entry_sent = true;
            }
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::AuthorityReceipt =>
            {
                evidence.receipts_sent += 1;
            }
            KernelEffect::ApplyAuthorityMaterial {
                operation_id: applied_operation,
                ..
            } if applied_operation == operation_id => {
                evidence.material_applied = true;
            }
            KernelEffect::ProjectAuthorityControl {
                operation_id: projected_operation,
                ..
            } if projected_operation == operation_id => {
                evidence.control_projected = true;
            }
            _ => {}
        }
    }
    Ok(())
}

fn drain_pair_network(
    pair: &mut SimulatedPair,
    operation_id: &OperationId,
    evidence: &mut CycleEvidence,
    checksum: &mut u64,
) -> TestResult<u64> {
    for (steps, _) in (0..256).enumerate() {
        if pair.snapshot()?.network.queued_packet_ids.is_empty() {
            return Ok(steps as u64);
        }
        let step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        })?;
        observe_cycle_step(&step, operation_id, evidence, checksum)?;
    }
    Err("proposal benchmark pair did not quiesce".into())
}

#[test]
fn m2_proposal_receipt_cycles() -> TestResult {
    let mut pair = protocol_pair(PROPOSAL_SEED.parse::<u64>()?)?;
    let mut checksum = FNV_OFFSET;
    let mut pair_steps = 0_u64;

    for index in 0..PROPOSAL_CYCLES {
        let operation_id = operation(format!("turn/benchmark/{index}"))?;
        let mut evidence = CycleEvidence::default();

        let submitted = pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false)?;
        observe_cycle_step(&submitted, &operation_id, &mut evidence, &mut checksum)?;
        pair_steps += 1;
        assert!(evidence.command_submitted);
        assert!(evidence.proposal_sent);

        let released = pair.key_up(PairEndpoint::Guest, PhysicalKey::Enter)?;
        observe_cycle_step(&released, &operation_id, &mut evidence, &mut checksum)?;
        pair_steps += 1;

        pair_steps += drain_pair_network(&mut pair, &operation_id, &mut evidence, &mut checksum)?;
        let snapshot = pair.snapshot()?;
        assert!(snapshot.network.queued_packet_ids.is_empty());
        assert_eq!(snapshot.guest.ui.kind, UiViewKind::Command);
        assert_eq!(snapshot.guest.ui.owner_seat, Some(seat(1)));
        assert!(snapshot.guest.ui.actionable);
        assert_eq!(snapshot.host.ui.kind, UiViewKind::Command);
        assert_eq!(snapshot.host.ui.owner_seat, Some(seat(0)));
        assert!(snapshot.host.ui.actionable);
        assert!(evidence.authority_entry_sent);
        assert!(evidence.material_applied);
        assert!(evidence.control_projected);
        assert!(evidence.receipts_sent >= 1);
        absorb(&mut checksum, &snapshot.guest.state_digest)?;
    }

    let final_snapshot = pair.teardown("m2 benchmark proposal teardown")?;
    assert!(final_snapshot.host.live_resources.timers.is_empty());
    assert!(final_snapshot.guest.live_resources.timers.is_empty());
    assert!(
        final_snapshot
            .host
            .live_resources
            .delivery_leases
            .is_empty()
    );
    assert!(
        final_snapshot
            .host
            .live_resources
            .retained_revisions
            .is_empty()
    );
    assert!(
        final_snapshot
            .guest
            .live_resources
            .proposal_leases
            .is_empty()
    );
    assert!(final_snapshot.clock_timers.is_empty());
    for endpoint in [&final_snapshot.host, &final_snapshot.guest] {
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
    assert!(final_snapshot.network.queued_packet_ids.is_empty());
    assert!(final_snapshot.network.disposed);
    assert!(final_snapshot.presenter.pending_event_ids.is_empty());
    assert!(final_snapshot.presenter.settled_event_ids.is_empty());
    assert!(final_snapshot.presenter.disposed);
    assert!(final_snapshot.storage.disposed);
    absorb(&mut checksum, &final_snapshot)?;

    report(
        "proposal-receipt-cycles",
        PROPOSAL_SEED,
        PROPOSAL_CYCLES,
        0,
        0,
        checksum,
        json!({
            "pair_steps": pair_steps,
            "cycles": PROPOSAL_CYCLES,
            "final_sequence": final_snapshot.sequence,
        }),
    )
}

fn schedule_frame(schedule: u64, ordinal: u64) -> RawFrame {
    let frame_type = match ordinal {
        0 => "futureBenchmarkFrame",
        1 => "authorityReceipt",
        _ => "authorityEntry",
    };
    RawFrame::JsonValue(json!({
        "v": 2,
        "t": frame_type,
        "body": {"schedule": schedule, "ordinal": ordinal},
    }))
}

fn fault_protocol_kernel() -> TestResult<GameKernel> {
    Ok(GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui: choice_menu(seat(1))?,
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: benchmark_context(1)?,
                    authority_seat_id: seat(0),
                    authority_connection_generation: ConnectionGeneration::ZERO,
                },
                proposal_leases: proposal_lease_config(),
                recovery: recovery_config()?,
            },
            menu_plans: Vec::new(),
        }),
    }))
}

fn consume_network_events(
    events: Vec<NetworkEvent>,
    kernel: &mut GameKernel,
    validator: &FrameValidator,
    checksum: &mut u64,
) -> TestResult<u64> {
    let mut delivered_frames = 0_u64;
    for event in events {
        absorb(checksum, &event)?;
        match event {
            NetworkEvent::Delivered { packet } => {
                let NetworkPayload::Frame(raw) = packet.payload else {
                    continue;
                };
                let validation = validator.validate(&raw);
                absorb(checksum, &validation)?;
                let effects = kernel.step(KernelInput::RawNetworkFrame {
                    endpoint: packet.to,
                    frame: raw,
                })?;
                absorb(checksum, &effects)?;
                delivered_frames += 1;
            }
            NetworkEvent::Dropped { .. } => {}
        }
    }
    Ok(delivered_frames)
}

#[test]
fn m2_fault_network_schedules() -> TestResult {
    let fault_seed = FAULT_SEED.parse::<u64>()?;
    let host = seat(0);
    let guest = seat(1);
    let endpoints = [host, guest];
    let validator = FrameValidator::new();
    let mut checksum = FNV_OFFSET;
    let mut delivered_frames = 0_u64;
    let mut events_seen = 0_u64;

    for schedule in 0..FAULT_SCHEDULES {
        let seed = fault_seed.wrapping_add(schedule.wrapping_mul(0x9e37_79b9));
        let mut network = FaultNetwork::new(seed, endpoints);
        let mut kernel = fault_protocol_kernel()?;
        let first = network.enqueue(
            host,
            guest,
            ConnectionGeneration::ZERO,
            NetworkPayload::Frame(schedule_frame(schedule, 0)),
            SafeU53::ZERO,
        )?;
        let second = network.enqueue(
            host,
            guest,
            ConnectionGeneration::ZERO,
            NetworkPayload::Frame(schedule_frame(schedule, 1)),
            SafeU53::ZERO,
        )?;
        let third = network.enqueue(
            guest,
            host,
            ConnectionGeneration::ZERO,
            NetworkPayload::Frame(schedule_frame(schedule, 2)),
            SafeU53::ZERO,
        )?;
        absorb(&mut checksum, &network.diagnostics())?;

        if schedule % 2 == 0 {
            network.apply(
                FaultOperation::Duplicate { packet_id: first },
                SafeU53::ZERO,
            )?;
        }
        if schedule % 3 == 0 {
            network.apply(
                FaultOperation::Delay {
                    packet_id: second,
                    additional_ms: safe(schedule % 7),
                },
                SafeU53::ZERO,
            )?;
        }
        if schedule % 5 == 0 {
            network.apply(
                FaultOperation::Corrupt {
                    packet_id: third,
                    corruption: FrameCorruption::MalformedJson {
                        text: "{".to_owned(),
                    },
                },
                SafeU53::ZERO,
            )?;
        }
        if schedule % 7 == 0 {
            network.apply(
                FaultOperation::Reorder {
                    packet_ids: vec![third, first],
                },
                SafeU53::ZERO,
            )?;
        }

        let immediate = network.apply(FaultOperation::DeliverNext, SafeU53::ZERO)?;
        events_seen += immediate.len() as u64;
        delivered_frames +=
            consume_network_events(immediate, &mut kernel, &validator, &mut checksum)?;

        if schedule % 11 == 0 {
            assert!(network.disconnect(host));
            network.reconnect(host)?;
        }
        let due = network.deliver_due(safe(32))?;
        events_seen += due.len() as u64;
        delivered_frames += consume_network_events(due, &mut kernel, &validator, &mut checksum)?;

        for _ in 0..8 {
            if network.diagnostics().queued_packet_ids.is_empty() {
                break;
            }
            let events = network.apply(FaultOperation::DeliverNext, safe(32))?;
            events_seen += events.len() as u64;
            delivered_frames +=
                consume_network_events(events, &mut kernel, &validator, &mut checksum)?;
        }
        assert!(network.diagnostics().queued_packet_ids.is_empty());
        absorb(&mut checksum, &network.diagnostics())?;
        let disposed_effects = kernel.dispose("m2 benchmark fault schedule teardown");
        absorb(&mut checksum, &disposed_effects)?;
        assert!(kernel.is_disposed());
        network.dispose();
        assert!(network.diagnostics().disposed);
    }

    assert!(events_seen >= FAULT_SCHEDULES);
    assert!(delivered_frames > 0);
    report(
        "fault-network-schedules",
        FAULT_SEED,
        0,
        FAULT_SCHEDULES,
        0,
        checksum,
        json!({
            "schedules": FAULT_SCHEDULES,
            "events_seen": events_seen,
            "delivered_frames": delivered_frames,
        }),
    )
}

fn synthetic_pair_kernel(owner: SeatId) -> TestResult<KernelConfig> {
    Ok(KernelConfig {
        input_map: input_map(),
        initial_ui: choice_menu(owner)?,
        protocol: None,
    })
}

fn synthetic_operation(index: u64) -> PairOperation {
    let endpoint = if (index / 2).is_multiple_of(2) {
        PairEndpoint::Host
    } else {
        PairEndpoint::Guest
    };
    let event = match index % 12 {
        0 => RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowDown,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        1 => RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
        2 => RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowUp,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        3 => RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowUp,
        },
        4 => RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        5 => RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
        6 => RawInputEvent::WindowBlurred,
        7 => RawInputEvent::WindowFocused,
        8 => RawInputEvent::FocusChanged(InputFocus::Game),
        9 => RawInputEvent::FocusChanged(InputFocus::TextEntry),
        10 => RawInputEvent::FocusChanged(InputFocus::Game),
        _ => RawInputEvent::WindowFocused,
    };

    if index % 12 == 11 {
        PairOperation::AdvanceTime { delta_ms: safe(1) }
    } else {
        PairOperation::RawInput { endpoint, event }
    }
}

#[test]
fn m2_synthetic_pair_campaign() -> TestResult {
    let campaign_seed = CAMPAIGN_SEED.parse::<u64>()?;
    let host = seat(0);
    let guest = seat(1);
    let mut pair = SimulatedPair::new(SimulatedPairConfig {
        host_kernel: synthetic_pair_kernel(host)?,
        guest_kernel: synthetic_pair_kernel(guest)?,
        host_seat: host,
        guest_seat: guest,
        seed: campaign_seed,
        presenter: PresenterMode::Instant,
        initial_storage: BTreeMap::new(),
        event_budget: safe(2_048),
    })?;
    let mut checksum = FNV_OFFSET;

    for index in 0..CAMPAIGN_STEPS {
        let step = pair.apply(synthetic_operation(index))?;
        assert_eq!(step.sequence, safe(index + 1));
        absorb(&mut checksum, &step.generated_effects)?;
        absorb(&mut checksum, &step.effects_digest)?;
        absorb(&mut checksum, &step.snapshot)?;
    }

    let final_snapshot = pair.teardown("m2 benchmark synthetic teardown")?;
    assert_eq!(final_snapshot.sequence, safe(CAMPAIGN_STEPS));
    assert!(final_snapshot.host.live_resources.timers.is_empty());
    assert!(final_snapshot.guest.live_resources.timers.is_empty());
    assert!(final_snapshot.host.live_resources.presentations.is_empty());
    assert!(final_snapshot.guest.live_resources.presentations.is_empty());
    assert!(final_snapshot.clock_timers.is_empty());
    for endpoint in [&final_snapshot.host, &final_snapshot.guest] {
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
    assert!(final_snapshot.network.queued_packet_ids.is_empty());
    assert!(final_snapshot.network.disposed);
    assert!(final_snapshot.presenter.pending_event_ids.is_empty());
    assert!(final_snapshot.presenter.settled_event_ids.is_empty());
    assert!(final_snapshot.presenter.disposed);
    assert!(final_snapshot.storage.disposed);
    absorb(&mut checksum, &final_snapshot)?;

    report(
        "synthetic-pair-campaign",
        CAMPAIGN_SEED,
        0,
        0,
        CAMPAIGN_STEPS,
        checksum,
        json!({
            "pair_sequence": final_snapshot.sequence,
            "host_state_digest": final_snapshot.host.state_digest,
            "guest_state_digest": final_snapshot.guest.state_digest,
        }),
    )
}
