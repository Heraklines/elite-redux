use std::collections::BTreeMap;
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, KernelEffect, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, FrameType,
    PeerBinding, ProposalFingerprintInput, ProposalJson, ProposalLeaseConfig,
    RecoveryTransactionConfig, ScheduledTimer, SchedulerCommand, control_id_of,
    proposal_fingerprint,
};
use er_sim::{
    FaultOperation, FrameCorruption, PairEndpoint, PairOperation, PairSnapshot, PairStep,
    PresenterMode, SimulatedPair, SimulatedPairConfig, SimulatedPairError, VirtualClock,
    VirtualClockError,
};
use er_types::{
    AuthorityEntryKind, AwaitSuccessorControl, CancelPolicy, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, FrameContext, GameButton, InputMap, KeyBinding,
    LiveResourceSnapshot, Material, MembershipRevision, MenuGeneration, MenuOption, MenuOptionId,
    MenuState, NextControl, OperationId, PhysicalKey, SafeI53, SafeU53, SeatId, SessionId,
    TerminalState, TimeClass, TimerId, TimerOwner, UiIntent, UiState, UiViewKind,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const ABSOLUTE_PROPOSAL_CEILING_MS: u64 = 1_200_000;
const RECOVERY_REQUEST_TIMEOUT_MS: u64 = 300_000;
const RESOURCE_SEED: u64 = 0x4d_3242_3130;

const GUEST_OPERATION: &str = "teardown/guest";
const HOST_OPERATION: &str = "teardown/host";
const GUEST_OPTION_A: &str = "command:teardown:a";
const GUEST_OPTION_B: &str = "command:teardown:b";
const HOST_OPTION: &str = "command:teardown:host";
const GUEST_A_WIRE: &str = r#"{"choice":"a"}"#;
const GUEST_B_WIRE: &str = r#"{"choice":"b"}"#;
const HOST_WIRE: &str = r#"{"choice":"host"}"#;
const GUEST_A_REWARD: &str = r#"{"surface":"guest-command","slot":0}"#;
const GUEST_B_REWARD: &str = r#"{"surface":"guest-command","slot":1}"#;
const HOST_REWARD: &str = r#"{"surface":"host-command","slot":1}"#;

#[derive(Clone, Debug)]
struct CommandFixture {
    config: SimulatedPairConfig,
    await_control_id: String,
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("resource teardown value must fit SafeU53")
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("resource teardown operation must be non-empty")
}

fn ordinary_fingerprint(
    sequence: u64,
    choice: i64,
    wire: &str,
    reward_surface: &str,
) -> TestResult<String> {
    Ok(proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(sequence),
        label: "turnCommand".to_owned(),
        choice: SafeI53::new(choice)?,
        wire: Some(ProposalJson::new(wire)?),
        reward_surface: Some(ProposalJson::new(reward_surface)?),
    })?)
}

fn menu_option(value: &str) -> MenuOption {
    MenuOption {
        id: MenuOptionId::new(value).expect("resource teardown option must be non-empty"),
        label_key: format!("menu.{value}"),
        enabled: true,
        visible: true,
    }
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

fn context(sender_seat_id: u64) -> FrameContext {
    FrameContext {
        session_id: SessionId::new("m2b-10-resource-teardown")
            .expect("resource teardown session must be non-empty"),
        run_id: er_types::RunId::new("m2b-10-resource-run")
            .expect("resource teardown run must be non-empty"),
        session_epoch: safe(1),
        seat_map_id: "m2b-10-resource-seats".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(0),
        connection_generation: ConnectionGeneration::ZERO,
    }
}

fn target(owner_seat_id: u64, pokemon_id: u64, field_index: u64) -> CommandControlTarget {
    CommandControlTarget {
        owner_seat_id: seat(owner_seat_id),
        pokemon_id: safe(pokemon_id),
        field_index: safe(field_index),
    }
}

fn command_control(commands: Vec<CommandControlTarget>) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        commands,
    })
}

fn initial_control() -> NextControl {
    command_control(vec![target(1, 42, 0), target(0, 99, 1)])
}

fn remaining_control() -> NextControl {
    command_control(vec![target(0, 99, 1)])
}

fn await_control() -> NextControl {
    NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id: operation(HOST_OPERATION),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        allowed_kinds: vec![AuthorityEntryKind::TurnCommit],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: false,
        expected_operation_id: None,
    })
}

fn command_menu(
    owner_seat_id: SeatId,
    operation_id: OperationId,
    control_id: String,
    options: Vec<MenuOption>,
) -> UiState {
    UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: Some(owner_seat_id),
        actionable: true,
        stack: vec![MenuState::Command(er_types::CommandMenu {
            operation_id,
            control_id,
            cursor: SafeU53::ZERO,
            options,
            cancel: CancelPolicy::Disabled,
        })],
    }
}

fn command_plan(
    control_id: String,
    owner_seat_id: SeatId,
    operation_id: OperationId,
    field_index: u64,
    options: Vec<MenuOption>,
    proposals: Vec<MenuProposalPlan>,
) -> ControlMenuPlan {
    ControlMenuPlan::Command {
        control_id,
        owner_seat_id,
        operation_id,
        field_index: safe(field_index),
        options,
        proposals,
        cancel: CancelPolicy::Disabled,
    }
}

fn authority_resolution(
    operation_id: OperationId,
    fingerprint: &str,
    field_index: u64,
    choice: &str,
    next_control: NextControl,
) -> AuthorityResolutionPlan {
    AuthorityResolutionPlan {
        operation_id: operation_id.clone(),
        fingerprint: fingerprint.to_owned(),
        draft: AuthorityEntryDraft {
            context: context(0),
            operation_id,
            kind: AuthorityEntryKind::TurnCommit,
            material: Material {
                digest: format!("teardown:digest:{choice}"),
                payload: json!({
                    "epoch": 1,
                    "wave": 1,
                    "turn": 1,
                    "fieldIndex": field_index,
                    "choice": choice,
                }),
            },
            next_control,
            subsumes: Vec::new(),
        },
    }
}

fn command_fixture(seed: u64, presenter: PresenterMode) -> TestResult<CommandFixture> {
    let initial = initial_control();
    let remaining = remaining_control();
    let awaiting = await_control();
    let initial_control_id = control_id_of(&initial);
    let remaining_control_id = control_id_of(&remaining);
    let await_control_id = control_id_of(&awaiting);
    let guest_operation = operation(GUEST_OPERATION);
    let host_operation = operation(HOST_OPERATION);

    let guest_options = vec![menu_option(GUEST_OPTION_A), menu_option(GUEST_OPTION_B)];
    let host_options = vec![menu_option(HOST_OPTION)];
    let guest_a_fingerprint = ordinary_fingerprint(1, 0, GUEST_A_WIRE, GUEST_A_REWARD)?;
    let guest_b_fingerprint = ordinary_fingerprint(1, 1, GUEST_B_WIRE, GUEST_B_REWARD)?;
    let host_fingerprint = ordinary_fingerprint(2, 0, HOST_WIRE, HOST_REWARD)?;
    assert_eq!(
        guest_a_fingerprint,
        r#"[1,"turnCommand",0,{"choice":"a"},{"surface":"guest-command","slot":0}]"#
    );
    assert_eq!(
        guest_b_fingerprint,
        r#"[1,"turnCommand",1,{"choice":"b"},{"surface":"guest-command","slot":1}]"#
    );
    assert_eq!(
        host_fingerprint,
        r#"[2,"turnCommand",0,{"choice":"host"},{"surface":"host-command","slot":1}]"#
    );
    let guest_proposals = vec![
        MenuProposalPlan {
            option_id: guest_options[0].id.clone(),
            fingerprint: guest_a_fingerprint.clone(),
            payload: json!({"choice": "a"}),
        },
        MenuProposalPlan {
            option_id: guest_options[1].id.clone(),
            fingerprint: guest_b_fingerprint.clone(),
            payload: json!({"choice": "b"}),
        },
    ];
    let host_proposals = vec![MenuProposalPlan {
        option_id: host_options[0].id.clone(),
        fingerprint: host_fingerprint.clone(),
        payload: json!({"choice": "host"}),
    }];

    let menu_plans = vec![
        command_plan(
            initial_control_id.clone(),
            seat(1),
            guest_operation.clone(),
            0,
            guest_options.clone(),
            guest_proposals.clone(),
        ),
        command_plan(
            initial_control_id.clone(),
            seat(0),
            host_operation.clone(),
            1,
            host_options.clone(),
            host_proposals.clone(),
        ),
        command_plan(
            remaining_control_id.clone(),
            seat(0),
            host_operation.clone(),
            1,
            host_options.clone(),
            host_proposals,
        ),
    ];

    let resolutions = vec![
        authority_resolution(
            guest_operation.clone(),
            &guest_a_fingerprint,
            0,
            "a",
            remaining.clone(),
        ),
        authority_resolution(guest_operation, &guest_b_fingerprint, 0, "b", remaining),
        authority_resolution(host_operation, &host_fingerprint, 1, "host", awaiting),
    ];

    let host_kernel = KernelConfig {
        input_map: input_map(),
        initial_ui: command_menu(
            seat(1),
            operation(GUEST_OPERATION),
            initial_control_id.clone(),
            guest_options.clone(),
        ),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: AuthorityLogConfig {
                    local_context: context(0),
                    peer_bindings: vec![PeerBinding {
                        seat_id: seat(1),
                        connection_generation: ConnectionGeneration::ZERO,
                    }],
                    owner_id: "m2b-10:authority".to_owned(),
                    retain_capacity: safe(16),
                    delivery_backoff: BackoffPolicy {
                        initial_ms: safe(250),
                        maximum_ms: safe(5_000),
                        factor_numerator: safe(2),
                        factor_denominator: safe(1),
                    },
                    delivery_time_class: TimeClass::Connected,
                    max_delivery_attempts: Some(safe(8)),
                },
                proposal_capacity: safe(8_192),
                resolutions,
            },
            menu_plans: menu_plans.clone(),
        }),
    };

    let guest_kernel = KernelConfig {
        input_map: input_map(),
        initial_ui: command_menu(
            seat(1),
            operation(GUEST_OPERATION),
            initial_control_id,
            guest_options,
        ),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: context(1),
                    authority_seat_id: seat(0),
                    authority_connection_generation: ConnectionGeneration::ZERO,
                },
                proposal_leases: ProposalLeaseConfig {
                    owner_prefix: "m2b-10:proposal:".to_owned(),
                    retry_initial_ms: safe(250),
                    retry_maximum_ms: safe(5_000),
                    absolute_ceiling_ms: safe(ABSOLUTE_PROPOSAL_CEILING_MS),
                },
                recovery: RecoveryTransactionConfig {
                    local_context: context(1),
                    request_timeout_ms: safe(RECOVERY_REQUEST_TIMEOUT_MS),
                    control_timeout_ms: safe(30_000),
                    pacing_ms: safe(16),
                    timer_owner_id: "m2b-10:recovery".to_owned(),
                },
            },
            menu_plans,
        }),
    };

    let mut initial_storage = BTreeMap::new();
    initial_storage.insert(
        "m2b-10:seed".to_owned(),
        json!({"seed": seed.to_string(), "purpose": "teardown evidence"}),
    );

    Ok(CommandFixture {
        config: SimulatedPairConfig {
            host_kernel,
            guest_kernel,
            host_seat: seat(0),
            guest_seat: seat(1),
            seed,
            presenter,
            initial_storage,
            event_budget: safe(32_768),
        },
        await_control_id,
    })
}

fn assert_zero_resources(snapshot: &PairSnapshot) {
    for endpoint in [&snapshot.host, &snapshot.guest] {
        assert!(endpoint.live_resources.timers.is_empty());
        assert!(endpoint.live_resources.presentations.is_empty());
        assert!(endpoint.live_resources.storage_requests.is_empty());
        assert!(endpoint.live_resources.delivery_leases.is_empty());
        assert!(endpoint.live_resources.proposal_leases.is_empty());
        assert!(endpoint.live_resources.recovery_transactions.is_empty());
        assert!(endpoint.live_resources.waits.is_empty());
        assert!(endpoint.live_resources.retained_revisions.is_empty());
        assert!(endpoint.live_resources.controls.is_empty());
        assert!(endpoint.live_resources.network_packets.is_empty());
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
    assert_eq!(
        snapshot.host.live_resources,
        LiveResourceSnapshot::default(),
        "host retained live resources after teardown"
    );
    assert_eq!(
        snapshot.guest.live_resources,
        LiveResourceSnapshot::default(),
        "guest retained live resources after teardown"
    );
    assert!(snapshot.clock_timers.is_empty());
    assert!(snapshot.network.queued_packet_ids.is_empty());
    assert!(snapshot.network.disconnected_endpoints.is_empty());
    assert!(snapshot.network.suspended_endpoints.is_empty());
    assert!(snapshot.network.disposed);
    assert!(snapshot.presenter.pending_event_ids.is_empty());
    assert!(snapshot.presenter.settled_event_ids.is_empty());
    assert!(snapshot.presenter.disposed);
    assert!(snapshot.storage.pending_request_ids.is_empty());
    assert!(snapshot.storage.keys.is_empty());
    assert!(snapshot.storage.disposed);
}

fn assert_terminal_snapshot(snapshot: &PairSnapshot, terminal: &TerminalState) -> TestResult {
    assert!(!terminal.terminal_id.is_empty());
    assert!(!terminal.reason.is_empty());
    assert_eq!(
        snapshot.terminal_reason.as_deref(),
        Some(terminal.reason.as_str()),
        "pair terminal reason must preserve the exact terminal effect"
    );

    assert_eq!(snapshot.host.ui.kind, UiViewKind::Terminal);
    assert_eq!(snapshot.guest.ui.kind, UiViewKind::Terminal);
    assert_eq!(snapshot.host.ui.kind, snapshot.guest.ui.kind);
    assert_eq!(snapshot.host.ui.owner_seat, None);
    assert_eq!(snapshot.guest.ui.owner_seat, None);
    assert_eq!(snapshot.host.ui.owner_seat, snapshot.guest.ui.owner_seat);
    assert!(!snapshot.host.ui.actionable);
    assert!(!snapshot.guest.ui.actionable);
    assert_eq!(snapshot.host.ui.actionable, snapshot.guest.ui.actionable);
    assert_eq!(
        snapshot.host.ui.prompt_key.as_deref(),
        Some(terminal.reason.as_str())
    );
    assert_eq!(
        snapshot.guest.ui.prompt_key.as_deref(),
        Some(terminal.reason.as_str())
    );
    assert_eq!(
        snapshot.host.ui.prompt_key, snapshot.guest.ui.prompt_key,
        "host and guest terminal view models must be symmetric"
    );

    assert_eq!(snapshot.host.kernel.ui.owner_seat, None);
    assert_eq!(snapshot.guest.kernel.ui.owner_seat, None);
    assert!(!snapshot.host.kernel.ui.actionable);
    assert!(!snapshot.guest.kernel.ui.actionable);
    assert_eq!(
        snapshot.host.kernel.ui.stack, snapshot.guest.kernel.ui.stack,
        "host and guest terminal kernel UI must be symmetric"
    );
    for (endpoint_name, endpoint) in [("host", &snapshot.host), ("guest", &snapshot.guest)] {
        assert_eq!(endpoint.kernel.ui.owner_seat, None);
        assert!(!endpoint.kernel.ui.actionable);
        assert_eq!(endpoint.kernel.ui.stack.len(), 1);
        match endpoint.kernel.ui.stack.first() {
            Some(MenuState::Terminal(menu)) => {
                assert_eq!(menu.terminal_id, terminal.terminal_id);
                assert_eq!(menu.prompt_key.as_deref(), Some(terminal.reason.as_str()));
            }
            other => {
                return Err(format!(
                    "{endpoint_name} terminal kernel UI was not projected: {other:?}"
                )
                .into());
            }
        }
        // Generations are endpoint-local; each public view must match its canonical UI.
        assert_eq!(endpoint.kernel.ui.generation, endpoint.ui.generation);
        assert_eq!(endpoint.ui.kind, UiViewKind::Terminal);
        assert_eq!(endpoint.ui.owner_seat, None);
        assert!(!endpoint.ui.actionable);
        assert_eq!(endpoint.ui.cursor, None);
        assert!(endpoint.ui.options.is_empty());
        assert_eq!(
            endpoint.ui.prompt_key.as_deref(),
            Some(terminal.reason.as_str())
        );
    }
    Ok(())
}

fn assert_terminal_trace(steps: &[PairStep]) -> TestResult<(TerminalState, PairSnapshot)> {
    let terminal_effects = steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::EnterSharedTerminal { terminal } => Some(terminal.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        terminal_effects.len(),
        1,
        "triggering trace must enter the shared terminal exactly once"
    );
    let terminal = terminal_effects
        .into_iter()
        .next()
        .expect("exactly one terminal effect was asserted");
    let triggering_step = steps
        .iter()
        .find(|step| {
            step.generated_effects
                .iter()
                .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
        })
        .ok_or("terminal effect was not associated with a triggering step")?;
    assert_terminal_snapshot(&triggering_step.snapshot, &terminal)?;
    assert_zero_resources(&triggering_step.snapshot);
    Ok((terminal, triggering_step.snapshot.clone()))
}

fn assert_absorbed_state(actual: &PairSnapshot, expected: &PairSnapshot) {
    assert_eq!(actual.seed, expected.seed);
    assert_eq!(actual.virtual_time_ms, expected.virtual_time_ms);
    assert_eq!(actual.clock_timers, expected.clock_timers);
    assert_eq!(actual.host, expected.host);
    assert_eq!(actual.guest, expected.guest);
    assert_eq!(actual.network, expected.network);
    assert_eq!(actual.presenter, expected.presenter);
    assert_eq!(actual.storage, expected.storage);
    assert_eq!(actual.terminal_reason, expected.terminal_reason);
}

fn assert_terminal_absorbing_path(
    pair: &mut SimulatedPair,
    trace: &[PairStep],
    teardown_reason: &str,
) -> TestResult {
    let (terminal, triggering_snapshot) = assert_terminal_trace(trace)?;
    let terminal_snapshot = pair.snapshot()?;
    assert_eq!(terminal_snapshot, triggering_snapshot);
    assert_terminal_snapshot(&terminal_snapshot, &terminal)?;

    let inert_steps = [
        pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false)?,
        pair.key_up(PairEndpoint::Guest, PhysicalKey::Enter)?,
        pair.advance_time(safe(10_000))?,
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        })?,
        pair.apply(PairOperation::Disconnect {
            endpoint: PairEndpoint::Guest,
        })?,
        pair.apply(PairOperation::Reconnect {
            endpoint: PairEndpoint::Host,
        })?,
        pair.apply(PairOperation::Suspend {
            endpoint: PairEndpoint::Host,
        })?,
        pair.apply(PairOperation::Resume {
            endpoint: PairEndpoint::Guest,
        })?,
    ];

    for (index, step) in inert_steps.iter().enumerate() {
        assert_eq!(step.sequence, step.snapshot.sequence);
        assert_eq!(
            step.sequence.get(),
            triggering_snapshot.sequence.get() + u64::try_from(index + 1)?
        );
        assert!(step.generated_effects.is_empty());
        assert_absorbed_state(&step.snapshot, &terminal_snapshot);
        assert_terminal_snapshot(&step.snapshot, &terminal)?;
        assert_zero_resources(&step.snapshot);
    }

    let before_teardown = pair.snapshot()?;
    let first_teardown = pair.teardown(teardown_reason);
    assert_eq!(first_teardown, Ok(before_teardown.clone()));
    let final_snapshot = first_teardown?;
    assert_eq!(final_snapshot, before_teardown);
    assert_terminal_snapshot(&final_snapshot, &terminal)?;
    assert_zero_resources(&final_snapshot);
    assert_post_disposal_rejected(pair)?;
    Ok(())
}

fn assert_post_disposal_rejected(pair: &mut SimulatedPair) -> TestResult {
    assert!(matches!(
        pair.teardown("repeated teardown"),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(pair.snapshot(), Err(SimulatedPairError::Disposed)));
    assert!(matches!(
        pair.apply(PairOperation::AdvanceTime {
            delta_ms: SafeU53::ZERO,
        }),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false),
        Err(SimulatedPairError::Disposed)
    ));
    Ok(())
}

fn assert_resource_identifiers(snapshot: &PairSnapshot) {
    for endpoint in [&snapshot.host, &snapshot.guest] {
        for owner in &endpoint.live_resources.delivery_leases {
            assert!(!owner.is_empty(), "delivery lease owner metadata is empty");
        }
        for operation_id in &endpoint.live_resources.proposal_leases {
            assert!(
                !operation_id.as_str().is_empty(),
                "proposal lease operation metadata is empty"
            );
        }
        for transaction in &endpoint.live_resources.recovery_transactions {
            assert!(
                !transaction.is_empty(),
                "recovery transaction metadata is empty"
            );
        }
        for wait in &endpoint.live_resources.waits {
            assert!(!wait.is_empty(), "wait address metadata is empty");
        }
        for control in &endpoint.live_resources.controls {
            assert!(!control.is_empty(), "control address metadata is empty");
        }
    }
}

fn recovery_fence_is_held(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            let frozen_fields = [
                "commandAdmissionFrozen",
                "controlSurfaceStartFrozen",
                "progressionFrozen",
                "materializationFrozen",
                "authorityWaitCreationFrozen",
            ];
            if object.get("state").and_then(Value::as_str) == Some("held")
                && frozen_fields
                    .iter()
                    .all(|field| object.contains_key(*field))
            {
                return true;
            }
            object.values().any(recovery_fence_is_held)
        }
        Value::Array(values) => values.iter().any(recovery_fence_is_held),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => false,
    }
}

fn assert_timer_metadata(steps: &[PairStep], expected_classes: &[TimeClass]) -> TestResult {
    for expected_class in expected_classes {
        let timer = steps
            .iter()
            .flat_map(|step| step.generated_effects.iter())
            .find_map(|effect| match effect {
                KernelEffect::ScheduleTimer {
                    owner,
                    delay_ms,
                    time_class,
                    ..
                } if time_class == expected_class => Some((owner, *delay_ms)),
                _ => None,
            })
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("missing scheduled timer metadata for {expected_class:?}"),
                )
            })?;
        assert!(timer.1 > SafeU53::ZERO);
        assert!(!timer.0.owner_id.is_empty());
        assert!(!timer.0.address.is_empty());
        assert!(!timer.0.reason.is_empty());
    }
    Ok(())
}

fn has_frame(steps: &[PairStep], frame_type: FrameType) -> bool {
    steps.iter().any(|step| {
        step.generated_effects.iter().any(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. } if frame.frame_type == frame_type
            )
        })
    })
}

fn frame_count(steps: &[PairStep], frame_type: FrameType) -> usize {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. } if frame.frame_type == frame_type
            )
        })
        .count()
}

fn has_effect<F>(steps: &[PairStep], mut predicate: F) -> bool
where
    F: FnMut(&KernelEffect) -> bool,
{
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .any(&mut predicate)
}

fn drain_network(pair: &mut SimulatedPair, trace: &mut Vec<PairStep>) -> TestResult {
    for _ in 0..512 {
        if pair.snapshot()?.network.queued_packet_ids.is_empty() {
            return Ok(());
        }
        trace.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        })?);
    }
    Err("resource teardown pair did not drain its deterministic network".into())
}

fn delay_all_queued(
    pair: &mut SimulatedPair,
    additional_ms: SafeU53,
    trace: &mut Vec<PairStep>,
) -> TestResult {
    let packet_ids = pair
        .snapshot()?
        .network
        .queued_packet_ids
        .into_iter()
        .collect::<Vec<_>>();
    for packet_id in packet_ids {
        trace.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id,
                additional_ms,
            },
        })?);
    }
    Ok(())
}

fn run_successful_lifecycle(seed: u64) -> TestResult<(Vec<PairStep>, PairSnapshot)> {
    let fixture = command_fixture(seed, PresenterMode::Instant)?;
    let mut pair = SimulatedPair::new(fixture.config)?;
    let initial = pair.snapshot()?;
    assert_eq!(initial.seed, seed.to_string());
    assert_eq!(initial.network.seed, seed.to_string());
    assert_eq!(initial.virtual_time_ms, SafeU53::ZERO);
    assert_eq!(initial.host.ui.kind, UiViewKind::Command);
    assert_eq!(initial.guest.ui.kind, UiViewKind::Command);
    assert!(!initial.storage.keys.is_empty());

    let mut trace = Vec::new();
    trace.push(pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?);
    trace.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?);
    trace.extend(pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?);
    drain_network(&mut pair, &mut trace)?;

    let host_menu = pair.snapshot()?;
    assert_eq!(host_menu.host.ui.kind, UiViewKind::Command);
    assert_eq!(host_menu.host.ui.owner_seat, Some(seat(0)));
    trace.extend(pair.press(PairEndpoint::Host, PhysicalKey::Enter)?);
    drain_network(&mut pair, &mut trace)?;

    assert_timer_metadata(
        &trace,
        &[
            TimeClass::HumanInput,
            TimeClass::Connected,
            TimeClass::Absolute,
        ],
    )?;
    assert!(has_effect(&trace, |effect| {
        matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint,
                intent: UiIntent::CommandSubmitted { .. },
            } if *endpoint == seat(1) || *endpoint == seat(0)
        )
    }));
    assert!(has_effect(&trace, |effect| matches!(
        effect,
        KernelEffect::SendProposal { .. }
    )));
    assert!(has_frame(&trace, FrameType::AuthorityEntry));
    assert!(has_frame(&trace, FrameType::AuthorityReceipt));
    assert!(has_effect(&trace, |effect| matches!(
        effect,
        KernelEffect::ApplyAuthorityMaterial { .. }
    )));
    assert!(has_effect(&trace, |effect| matches!(
        effect,
        KernelEffect::ProjectAuthorityControl { .. }
    )));
    assert!(has_effect(&trace, |effect| {
        matches!(
            effect,
            KernelEffect::ProjectAuthorityControl { control, .. }
                if control_id_of(control) == fixture.await_control_id
        )
    }));

    let quiescent = pair.snapshot()?;
    assert_eq!(quiescent.virtual_time_ms, SafeU53::ZERO);
    assert!(quiescent.network.queued_packet_ids.is_empty());
    assert!(quiescent.host.live_resources.delivery_leases.is_empty());
    assert!(quiescent.host.live_resources.retained_revisions.is_empty());
    assert_eq!(quiescent.guest.live_resources.proposal_leases.len(), 1);
    assert!(
        quiescent
            .guest
            .live_resources
            .proposal_leases
            .contains(&operation(GUEST_OPERATION)),
        "TurnCommit proposal lease must remain retained through receipt"
    );
    assert!(quiescent.host.live_resources.timers.is_empty());
    assert_eq!(quiescent.guest.live_resources.timers.len(), 2);
    assert_eq!(quiescent.clock_timers.len(), 2);
    let clock_timer_ids = quiescent
        .clock_timers
        .iter()
        .map(|timer| timer.timer.timer_id)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        clock_timer_ids, quiescent.guest.live_resources.timers,
        "the retained TurnCommit lease must own every quiescent clock timer"
    );
    let proposal_timer_owner = format!("m2b-10:proposal:{GUEST_OPERATION}");
    for (time_class, delay_ms, reason) in [
        (TimeClass::Connected, safe(250), "v2 proposal retry"),
        (
            TimeClass::Absolute,
            safe(ABSOLUTE_PROPOSAL_CEILING_MS),
            "v2 proposal absolute ceiling",
        ),
    ] {
        let timer = quiescent
            .clock_timers
            .iter()
            .find(|timer| timer.timer.time_class == time_class)
            .expect("retained TurnCommit proposal timer must remain live through receipt");
        assert_eq!(timer.timer.endpoint, seat(1));
        assert_eq!(
            timer.timer.owner.owner_id.as_str(),
            proposal_timer_owner.as_str()
        );
        assert_eq!(timer.timer.owner.address.as_str(), GUEST_OPERATION);
        assert_eq!(timer.timer.owner.reason.as_str(), reason);
        assert_eq!(timer.timer.delay_ms, delay_ms);
        assert_eq!(timer.remaining_active_ms, delay_ms);
        assert!(!timer.paused);
    }
    assert!(quiescent.host.live_resources.presentations.is_empty());
    assert!(quiescent.guest.live_resources.presentations.is_empty());
    assert!(quiescent.host.live_resources.storage_requests.is_empty());
    assert!(quiescent.guest.live_resources.storage_requests.is_empty());
    let await_prompt = format!("await/{HOST_OPERATION}");
    for endpoint in [&quiescent.host, &quiescent.guest] {
        assert_eq!(endpoint.ui.kind, UiViewKind::Waiting);
        assert!(!endpoint.ui.actionable);
        assert!(endpoint.live_resources.controls.is_empty());
        assert!(endpoint.live_resources.waits.contains(&await_prompt));
    }

    let final_snapshot = pair.teardown("m2b-10 successful lifecycle")?;
    assert_eq!(final_snapshot.seed, seed.to_string());
    assert_eq!(final_snapshot.network.seed, seed.to_string());
    assert_zero_resources(&final_snapshot);
    assert_post_disposal_rejected(&mut pair)?;
    Ok((trace, final_snapshot))
}

#[test]
fn successful_two_kernel_lifecycle_is_deterministic_and_tears_down_to_zero() -> TestResult {
    let first = run_successful_lifecycle(RESOURCE_SEED)?;
    let second = run_successful_lifecycle(RESOURCE_SEED)?;
    assert_eq!(first, second);
    Ok(())
}

#[test]
fn live_input_protocol_and_adapter_resources_are_all_released_by_pair_teardown() -> TestResult {
    let fixture = command_fixture(RESOURCE_SEED, PresenterMode::FaultControlled)?;
    let mut pair = SimulatedPair::new(fixture.config)?;
    let mut trace = Vec::new();

    let initial = pair.snapshot()?;
    assert_eq!(initial.seed, RESOURCE_SEED.to_string());
    assert_eq!(initial.network.seed, RESOURCE_SEED.to_string());
    assert_eq!(initial.virtual_time_ms, SafeU53::ZERO);

    // Keep an input-repeat timer live while the two kernels progress through
    // two real command/proposal/entry/control transitions.
    trace.push(pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?);
    trace.extend(pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?);
    assert_timer_metadata(
        &trace,
        &[
            TimeClass::HumanInput,
            TimeClass::Connected,
            TimeClass::Absolute,
        ],
    )?;

    let proposal_live = pair.snapshot()?;
    assert_resource_identifiers(&proposal_live);
    assert!(
        !proposal_live
            .guest
            .live_resources
            .proposal_leases
            .is_empty(),
        "proposal lease must be nonzero before teardown"
    );
    assert!(!proposal_live.guest.live_resources.timers.is_empty());
    assert!(!proposal_live.network.queued_packet_ids.is_empty());

    // Deliver only the opaque proposal. The authority now owns a retained
    // entry and a delivery lease, while its authority-entry packet remains in
    // the real FaultNetwork queue.
    trace.push(pair.apply(PairOperation::Fault {
        operation: FaultOperation::DeliverNext,
    })?);
    let authority_live = pair.snapshot()?;
    assert!(
        !authority_live
            .host
            .live_resources
            .delivery_leases
            .is_empty()
    );
    assert!(
        !authority_live
            .host
            .live_resources
            .retained_revisions
            .is_empty()
    );
    assert!(!authority_live.host.live_resources.timers.is_empty());

    // The first committed entry exposes the host command through the pair's
    // raw keyboard surface. The host's second local commit is queued as an
    // authority entry too; do not release any resulting receipt packets.
    trace.extend(pair.press(PairEndpoint::Host, PhysicalKey::Enter)?);
    assert_eq!(
        frame_count(&trace, FrameType::AuthorityEntry),
        2,
        "both command submissions must produce an authority entry"
    );

    // FaultControlled intentionally holds the first replica entry at its
    // presentation boundary. Deliver only until that adapter resource is
    // observable; the remaining authority/receipt traffic stays queued for
    // pair teardown to release.
    while pair
        .snapshot()?
        .guest
        .live_resources
        .presentations
        .is_empty()
    {
        if pair.snapshot()?.network.queued_packet_ids.is_empty() {
            return Err("missing queued authority entry for live-resource coverage".into());
        }
        trace.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        })?);
        if trace.len() > 512 {
            return Err("live-resource pair exceeded deterministic delivery budget".into());
        }
    }

    let live = pair.snapshot()?;
    assert_eq!(live.virtual_time_ms, SafeU53::ZERO);
    assert_resource_identifiers(&live);
    assert!(!live.host.live_resources.delivery_leases.is_empty());
    assert!(!live.host.live_resources.retained_revisions.is_empty());
    assert!(!live.guest.live_resources.presentations.is_empty());
    assert_eq!(live.guest.kernel.ui.stack, vec![MenuState::None]);
    assert_eq!(live.guest.ui.kind, UiViewKind::None);
    assert!(live.host.live_resources.controls.is_empty());
    assert!(live.guest.live_resources.controls.is_empty());
    assert!(
        !live.host.live_resources.waits.is_empty() || !live.guest.live_resources.waits.is_empty(),
        "await state must be represented before teardown"
    );
    assert!(
        !live.host.live_resources.timers.is_empty() || !live.guest.live_resources.timers.is_empty()
    );
    assert!(
        !live.host.live_resources.network_packets.is_empty()
            || !live.guest.live_resources.network_packets.is_empty()
            || !live.network.queued_packet_ids.is_empty(),
        "the pair must expose its queued network ownership before teardown"
    );
    assert!(!live.storage.keys.is_empty());

    // MemoryStorage is deliberately synchronous: pending_request_ids and the
    // endpoint storage_requests set cannot remain live across an exposed
    // PairSnapshot. The frozen adapter evidence is therefore the initialized
    // key set before teardown and zero pending requests at every boundary.
    assert!(live.storage.pending_request_ids.is_empty());
    assert!(live.host.live_resources.storage_requests.is_empty());
    assert!(live.guest.live_resources.storage_requests.is_empty());
    assert_timer_metadata(
        &trace,
        &[
            TimeClass::HumanInput,
            TimeClass::Connected,
            TimeClass::Absolute,
        ],
    )?;

    let final_snapshot = pair.teardown("m2b-10 live owners")?;
    assert_eq!(final_snapshot.seed, RESOURCE_SEED.to_string());
    assert_eq!(final_snapshot.network.seed, RESOURCE_SEED.to_string());
    assert_zero_resources(&final_snapshot);
    assert_post_disposal_rejected(&mut pair)?;
    Ok(())
}

#[test]
fn protocol_violation_path_tears_down_all_live_resources() -> TestResult {
    let fixture = command_fixture(RESOURCE_SEED, PresenterMode::Instant)?;
    let mut pair = SimulatedPair::new(fixture.config)?;

    // Submit through physical input, deliver the opaque proposal, then
    // corrupt the actual authority-entry frame before the guest sees it.
    let mut trace = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    let delivered_proposal = pair.apply(PairOperation::Fault {
        operation: FaultOperation::DeliverNext,
    })?;
    trace.push(delivered_proposal.clone());
    assert!(
        !delivered_proposal
            .snapshot
            .network
            .queued_packet_ids
            .is_empty()
    );
    let entry_packet = delivered_proposal
        .snapshot
        .network
        .queued_packet_ids
        .iter()
        .next()
        .copied()
        .ok_or("authority entry packet was not queued")?;
    let corrupted = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Corrupt {
            packet_id: entry_packet,
            corruption: FrameCorruption::DeleteField {
                json_pointer: "/t".to_owned(),
            },
        },
    })?;
    trace.push(corrupted.clone());
    assert!(
        corrupted
            .snapshot
            .network
            .queued_packet_ids
            .contains(&entry_packet)
    );
    let terminal = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: entry_packet,
        },
    })?;
    trace.push(terminal.clone());
    assert_terminal_absorbing_path(&mut pair, &trace, "m2b-10 protocol violation")?;
    Ok(())
}

#[test]
fn recovery_timeout_path_releases_fence_transaction_and_timers() -> TestResult {
    let fixture = command_fixture(RESOURCE_SEED, PresenterMode::Instant)?;
    let mut pair = SimulatedPair::new(fixture.config)?;

    let mut trace = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    let after_proposal = pair.apply(PairOperation::Fault {
        operation: FaultOperation::DeliverNext,
    })?;
    trace.push(after_proposal.clone());
    assert!(
        !after_proposal
            .snapshot
            .host
            .live_resources
            .delivery_leases
            .is_empty()
    );

    let disconnected = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    trace.push(disconnected);
    let reconnect = pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    trace.push(reconnect.clone());
    assert!(
        !reconnect
            .snapshot
            .guest
            .live_resources
            .recovery_transactions
            .is_empty(),
        "reconnect must retain a live recovery transaction before timeout"
    );
    assert_resource_identifiers(&reconnect.snapshot);
    assert!(
        recovery_fence_is_held(&reconnect.snapshot.guest.kernel.state),
        "recovery must hold its production fence before request completion"
    );
    assert!(!reconnect.snapshot.guest.live_resources.timers.is_empty());
    assert_timer_metadata(std::slice::from_ref(&reconnect), &[TimeClass::Recovery])?;

    // Keep the recovery request and any retained-entry redelivery beyond the
    // request timeout using virtual time only. The recovery fence must then
    // take the production pair through its terminal failure path.
    delay_all_queued(&mut pair, safe(1_000_000), &mut trace)?;
    let timed_out = pair.advance_time(safe(RECOVERY_REQUEST_TIMEOUT_MS))?;
    trace.push(timed_out.clone());
    assert_terminal_absorbing_path(&mut pair, &trace, "m2b-10 recovery timeout")?;
    Ok(())
}

#[test]
fn absolute_proposal_terminal_releases_retry_and_absolute_leases() -> TestResult {
    let fixture = command_fixture(RESOURCE_SEED, PresenterMode::Instant)?;
    let mut pair = SimulatedPair::new(fixture.config)?;

    let mut trace = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_timer_metadata(&trace, &[TimeClass::Connected, TimeClass::Absolute])?;
    let proposal_live = pair.snapshot()?;
    assert!(
        !proposal_live
            .guest
            .live_resources
            .proposal_leases
            .is_empty()
    );
    let proposal_packet = proposal_live
        .network
        .queued_packet_ids
        .iter()
        .next()
        .copied()
        .ok_or("proposal packet was not queued")?;
    trace.push(pair.apply(PairOperation::Fault {
        operation: FaultOperation::Drop {
            packet_id: proposal_packet,
        },
    })?);
    trace.push(pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?);

    let terminal = pair.advance_time(safe(ABSOLUTE_PROPOSAL_CEILING_MS))?;
    trace.push(terminal.clone());
    assert_eq!(
        terminal.snapshot.virtual_time_ms,
        safe(ABSOLUTE_PROPOSAL_CEILING_MS)
    );
    assert!(
        terminal
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .is_empty()
    );
    assert!(terminal.snapshot.guest.live_resources.timers.is_empty());
    assert_terminal_absorbing_path(&mut pair, &trace, "m2b-10 absolute proposal terminal")?;
    Ok(())
}

#[test]
fn secondary_virtual_clock_disposal_proves_pending_timer_zero_and_fail_closed_use() -> TestResult {
    // PairSnapshot teardown evidence covers pair-owned clock timers; this
    // narrow secondary check records the frozen VirtualClock seam itself.
    let mut clock = VirtualClock::new();
    let owner = TimerOwner::new(
        "m2b-10:secondary-clock",
        "m2b-10/secondary-clock/0",
        "secondary teardown evidence",
    )?;
    clock.apply(SchedulerCommand::Schedule {
        timer: ScheduledTimer {
            endpoint: seat(1),
            timer_id: TimerId::new(safe(0)),
            owner,
            delay_ms: safe(100),
            time_class: TimeClass::Recovery,
        },
    })?;
    assert_eq!(clock.pending_timers().len(), 1);
    clock.dispose();
    clock.dispose();
    assert!(clock.pending_timers().is_empty());
    assert_eq!(clock.advance(safe(1)), Err(VirtualClockError::Disposed));
    Ok(())
}
