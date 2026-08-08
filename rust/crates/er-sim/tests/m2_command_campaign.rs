use std::collections::BTreeMap;
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, KernelEffect, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding,
    ProposalLeaseConfig, RecoveryTransactionConfig, control_id_of,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig,
};
use er_types::{
    AuthorityEntryKind, AwaitSuccessorControl, CancelPolicy, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, FrameContext, GameButton, InputMap, KeyBinding,
    FrameType, Material, MenuGeneration, MenuOption, MenuOptionId, MenuState, MembershipRevision,
    NextControl, OperationId, PhysicalKey, RunId, SafeU53, SeatId, SessionId, TimeClass, UiIntent,
    UiState, UiViewKind,
};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const GUEST_OPERATION: &str = "turn/guest";
const HOST_OPERATION: &str = "turn/host";
const GUEST_OPTION_A: &str = "command:guest:a";
const GUEST_OPTION_B: &str = "command:guest:b";
const HOST_OPTION: &str = "command:host";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("campaign value must fit SafeU53")
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("campaign operation must be non-empty")
}

fn menu_option(value: &str) -> MenuOption {
    MenuOption {
        id: MenuOptionId::new(value).expect("campaign option must be non-empty"),
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
        session_id: SessionId::new("m2b-04-command-campaign")
            .expect("campaign session must be non-empty"),
        run_id: RunId::new("m2b-04-run").expect("campaign run must be non-empty"),
        session_epoch: safe(1),
        seat_map_id: "m2b-04-seat-map".to_owned(),
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
                digest: format!("digest:{choice}"),
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

fn authority_log_config() -> AuthorityLogConfig {
    AuthorityLogConfig {
        local_context: context(0),
        peer_bindings: vec![PeerBinding {
            seat_id: seat(1),
            connection_generation: ConnectionGeneration::ZERO,
        }],
        owner_id: "m2b-04-authority".to_owned(),
        retain_capacity: safe(16),
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250),
            maximum_ms: safe(5_000),
            factor_numerator: safe(2),
            factor_denominator: safe(1),
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: Some(safe(8)),
    }
}

fn proposal_lease_config() -> ProposalLeaseConfig {
    ProposalLeaseConfig {
        owner_prefix: "m2b-04:proposal:".to_owned(),
        retry_initial_ms: safe(250),
        retry_maximum_ms: safe(5_000),
        absolute_ceiling_ms: safe(1_200_000),
    }
}

fn recovery_config() -> RecoveryTransactionConfig {
    RecoveryTransactionConfig {
        local_context: context(1),
        request_timeout_ms: safe(300_000),
        control_timeout_ms: safe(30_000),
        pacing_ms: safe(16),
        timer_owner_id: "m2b-04:recovery".to_owned(),
    }
}

fn kernel_pair(seed: u64) -> TestResult<SimulatedPair> {
    let initial = initial_control();
    let remaining = remaining_control();
    let initial_id = control_id_of(&initial);
    let remaining_id = control_id_of(&remaining);
    let guest_operation = operation(GUEST_OPERATION);
    let host_operation = operation(HOST_OPERATION);

    let guest_options = vec![menu_option(GUEST_OPTION_A), menu_option(GUEST_OPTION_B)];
    let host_options = vec![menu_option(HOST_OPTION)];
    let guest_proposals = vec![
        MenuProposalPlan {
            option_id: guest_options[0].id.clone(),
            fingerprint: "fingerprint:guest:a".to_owned(),
            payload: json!({"choice": "a"}),
        },
        MenuProposalPlan {
            option_id: guest_options[1].id.clone(),
            fingerprint: "fingerprint:guest:b".to_owned(),
            payload: json!({"choice": "b"}),
        },
    ];
    let host_proposals = vec![MenuProposalPlan {
        option_id: host_options[0].id.clone(),
        fingerprint: "fingerprint:host".to_owned(),
        payload: json!({"choice": "host"}),
    }];

    let menu_plans = vec![
        command_plan(
            initial_id.clone(),
            seat(1),
            guest_operation.clone(),
            0,
            guest_options.clone(),
            guest_proposals.clone(),
        ),
        command_plan(
            initial_id.clone(),
            seat(0),
            host_operation.clone(),
            1,
            host_options.clone(),
            host_proposals.clone(),
        ),
        command_plan(
            remaining_id,
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
            "fingerprint:guest:a",
            0,
            "a",
            remaining.clone(),
        ),
        authority_resolution(
            guest_operation,
            "fingerprint:guest:b",
            0,
            "b",
            remaining,
        ),
        authority_resolution(
            host_operation,
            "fingerprint:host",
            1,
            "host",
            await_control(),
        ),
    ];

    let host_kernel = KernelConfig {
        input_map: input_map(),
        initial_ui: command_menu(
            seat(1),
            operation(GUEST_OPERATION),
            initial_id.clone(),
            guest_options.clone(),
        ),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: authority_log_config(),
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
            initial_id,
            guest_options,
        ),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: context(1),
                    authority_seat_id: seat(0),
                    authority_connection_generation: ConnectionGeneration::ZERO,
                },
                proposal_leases: proposal_lease_config(),
                recovery: recovery_config(),
            },
            menu_plans,
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

fn endpoint_seat(endpoint: PairEndpoint) -> SeatId {
    match endpoint {
        PairEndpoint::Host => seat(0),
        PairEndpoint::Guest => seat(1),
    }
}

fn has_command_intent(step: &PairStep, endpoint: PairEndpoint, operation_id: &str) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent: UiIntent::CommandSubmitted {
                    operation_id: submitted_operation,
                    ..
                },
            } if *effect_endpoint == endpoint_seat(endpoint)
                && submitted_operation.as_str() == operation_id
        )
    })
}

fn has_cursor_intent(step: &PairStep, endpoint: PairEndpoint) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent: UiIntent::CursorChanged { .. },
            } if *effect_endpoint == endpoint_seat(endpoint)
        )
    })
}

fn has_material_effect(step: &PairStep, operation_id: &str) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial {
                operation_id: effect_operation,
                ..
            } if effect_operation.as_str() == operation_id
        )
    })
}

fn has_control_effect(step: &PairStep, operation_id: &str) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ProjectAuthorityControl {
                operation_id: effect_operation,
                ..
            } if effect_operation.as_str() == operation_id
        )
    })
}

fn tail_request_effect_count(step: &PairStep) -> usize {
    step.generated_effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::TailRequest
            )
        })
        .count()
}

fn has_guest_tail_request_effect(step: &PairStep) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendFrame { from, frame }
                if *from == seat(1)
                    && frame.frame_type == FrameType::TailRequest
                    && frame.context == context(1)
                    && frame.body == json!({"fromRevision": 1})
        )
    })
}

fn drain_network(pair: &mut SimulatedPair, steps: &mut Vec<PairStep>) -> TestResult<()> {
    for _ in 0..128 {
        if pair.snapshot()?.network.queued_packet_ids.is_empty() {
            return Ok(());
        }
        steps.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        })?);
    }
    Err("command campaign network did not quiesce".into())
}

fn run_campaign(seed: u64) -> TestResult<(Vec<PairStep>, PairSnapshot)> {
    let mut pair = kernel_pair(seed)?;
    let mut steps = Vec::new();

    let initial = pair.snapshot()?;
    assert_eq!(initial.guest.ui.kind, UiViewKind::Command);
    assert_eq!(initial.guest.ui.owner_seat, Some(seat(1)));
    assert!(initial.guest.ui.actionable);
    assert_eq!(initial.host.ui.kind, UiViewKind::Command);
    assert_eq!(initial.host.ui.owner_seat, Some(seat(1)));
    assert!(initial.host.ui.actionable);
    assert!(initial.guest.ui.options[0].selected);

    let wrong_seat = pair.key_down(PairEndpoint::Host, PhysicalKey::Enter, false)?;
    assert_eq!(wrong_seat.snapshot.host.ui, initial.host.ui);
    assert!(wrong_seat.snapshot.network.queued_packet_ids.is_empty());
    assert!(!has_command_intent(
        &wrong_seat,
        PairEndpoint::Host,
        GUEST_OPERATION
    ));
    assert!(!has_cursor_intent(&wrong_seat, PairEndpoint::Host));
    steps.push(wrong_seat);
    steps.push(pair.key_up(PairEndpoint::Host, PhysicalKey::Enter)?);

    let moved = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?;
    assert_eq!(moved.snapshot.guest.ui.cursor, Some(safe(1)));
    assert!(has_cursor_intent(&moved, PairEndpoint::Guest));
    steps.push(moved);
    steps.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?);

    let guest_submitted = pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false)?;
    assert!(has_command_intent(
        &guest_submitted,
        PairEndpoint::Guest,
        GUEST_OPERATION
    ));
    steps.push(guest_submitted);
    steps.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::Enter)?);

    let after_guest_proposal = pair.snapshot()?;
    assert_eq!(after_guest_proposal.network.queued_packet_ids.len(), 1);
    steps.push(pair.apply(PairOperation::Fault {
        operation: FaultOperation::DeliverNext,
    })?);

    let after_first_commit = pair.snapshot()?;
    assert_eq!(after_first_commit.host.ui.kind, UiViewKind::Command);
    assert_eq!(after_first_commit.host.ui.owner_seat, Some(seat(0)));
    assert!(after_first_commit.host.ui.actionable);

    let host_submitted = pair.key_down(PairEndpoint::Host, PhysicalKey::Enter, false)?;
    assert!(has_command_intent(
        &host_submitted,
        PairEndpoint::Host,
        HOST_OPERATION
    ));
    steps.push(host_submitted);
    steps.push(pair.key_up(PairEndpoint::Host, PhysicalKey::Enter)?);

    let queued_entries = pair
        .snapshot()?
        .network
        .queued_packet_ids
        .into_iter()
        .collect::<Vec<_>>();
    assert_eq!(queued_entries.len(), 2);
    let first_entry_packet = queued_entries[0];
    let second_entry_packet = queued_entries[1];

    let before_n_plus_one = pair.snapshot()?;
    steps.push(pair.apply(PairOperation::Fault {
        operation: FaultOperation::Reorder {
            packet_ids: vec![second_entry_packet],
        },
    })?);
    let blocked = pair.apply(PairOperation::Fault {
        operation: FaultOperation::DeliverNext,
    })?;
    assert_eq!(blocked.snapshot.guest.ui, before_n_plus_one.guest.ui);
    let before_n_plus_one_packets = before_n_plus_one.network.queued_packet_ids.clone();
    assert_eq!(blocked.snapshot.network.queued_packet_ids.len(), 2);
    assert!(blocked
        .snapshot
        .network
        .queued_packet_ids
        .contains(&first_entry_packet));
    assert!(!blocked
        .snapshot
        .network
        .queued_packet_ids
        .contains(&second_entry_packet));
    let tail_request_packets = blocked
        .snapshot
        .network
        .queued_packet_ids
        .difference(&before_n_plus_one_packets)
        .copied()
        .collect::<Vec<_>>();
    assert_eq!(tail_request_packets.len(), 1);
    assert_eq!(tail_request_effect_count(&blocked), 1);
    assert!(has_guest_tail_request_effect(&blocked));
    assert!(!has_material_effect(&blocked, HOST_OPERATION));
    assert!(!has_control_effect(&blocked, HOST_OPERATION));
    let tail_request_packet = tail_request_packets[0];
    steps.push(blocked);

    let stale_input = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowUp, false)?;
    assert!(has_cursor_intent(&stale_input, PairEndpoint::Guest));
    steps.push(stale_input);

    let first_entry = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: first_entry_packet,
        },
    })?;
    assert_ne!(first_entry.snapshot.guest.ui.generation, before_n_plus_one.guest.ui.generation);
    assert!(!first_entry.snapshot.guest.ui.actionable);
    let first_entry_ui = first_entry.snapshot.guest.ui.clone();
    steps.push(first_entry);

    let stale_repeat = pair.advance_time(safe(250))?;
    assert_eq!(stale_repeat.snapshot.guest.ui, first_entry_ui);
    assert!(!has_cursor_intent(&stale_repeat, PairEndpoint::Guest));
    steps.push(stale_repeat);
    steps.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowUp)?);

    let replay_requested = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: tail_request_packet,
        },
    })?;
    assert!(!replay_requested
        .snapshot
        .network
        .queued_packet_ids
        .is_empty());
    steps.push(replay_requested);

    drain_network(&mut pair, &mut steps)?;
    let before_teardown = pair.snapshot()?;
    assert_eq!(before_teardown.guest.ui.kind, UiViewKind::Waiting);
    assert!(!before_teardown.guest.ui.actionable);
    assert!(before_teardown.network.queued_packet_ids.is_empty());
    assert!(before_teardown.host.live_resources.delivery_leases.is_empty());
    assert!(before_teardown.guest.live_resources.proposal_leases.is_empty());
    assert!(before_teardown.host.live_resources.timers.is_empty());
    assert!(before_teardown.guest.live_resources.timers.is_empty());

    let final_snapshot = pair.teardown("m2b-04 command campaign complete")?;
    assert_eq!(final_snapshot.host.live_resources, Default::default());
    assert_eq!(final_snapshot.guest.live_resources, Default::default());
    assert!(final_snapshot.network.queued_packet_ids.is_empty());
    assert!(final_snapshot.presenter.pending_event_ids.is_empty());
    assert!(final_snapshot.storage.pending_request_ids.is_empty());
    assert!(final_snapshot.network.disposed);
    assert!(final_snapshot.presenter.disposed);
    assert!(final_snapshot.storage.disposed);

    Ok((steps, final_snapshot))
}

#[test]
fn raw_key_command_campaign_covers_projection_progression_and_determinism() -> TestResult {
    let (first_steps, first_final) = run_campaign(0x4d_3242_3034)?;
    let (second_steps, second_final) = run_campaign(0x4d_3242_3034)?;

    assert_eq!(first_steps, second_steps);
    assert_eq!(first_final, second_final);
    assert!(first_steps.iter().all(|step| !step.effects_digest.is_empty()));
    assert!(first_steps
        .iter()
        .any(|step| step.generated_effects.iter().any(|effect| {
            matches!(effect, KernelEffect::SendProposal { .. })
        })));
    assert!(first_steps.iter().any(|step| has_material_effect(step, GUEST_OPERATION)));
    assert!(first_steps.iter().any(|step| has_material_effect(step, HOST_OPERATION)));
    Ok(())
}
