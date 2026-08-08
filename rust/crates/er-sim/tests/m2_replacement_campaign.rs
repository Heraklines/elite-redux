use std::collections::BTreeMap;
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, KernelEffect, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityEntryKind, AuthorityLogConfig, AuthorityReplicaConfig,
    BackoffPolicy, FrameContext, Material, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig, control_id_of,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig,
};
use er_types::{
    AwaitSuccessorControl, CancelPolicy, ConnectionGeneration, InputMap, KeyBinding,
    MenuGeneration, MenuOption, MenuOptionId, MenuState, MembershipRevision, OperationId,
    PhysicalKey, ReplacementControl, ReplacementControlAddress, ReplacementMenu, SafeU53, SeatId,
    SessionId, TimeClass, UiIntent, UiState, UiViewKind,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const HEAD_FINGERPRINT: &str = "replacement/head/party-beta";
const TAIL_FINGERPRINT: &str = "replacement/tail/party-alpha";

#[derive(Clone, Debug)]
struct ReplacementIds {
    host: SeatId,
    guest: SeatId,
    head_operation: OperationId,
    tail_operation: OperationId,
    head_control_id: String,
    tail_control_id: String,
    head_choice: MenuOptionId,
    tail_choice: MenuOptionId,
}

struct CampaignRun {
    trace: Vec<PairStep>,
    final_snapshot: PairSnapshot,
}

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn option(id: &str, enabled: bool) -> TestResult<MenuOption> {
    Ok(MenuOption {
        id: MenuOptionId::new(id.to_owned())?,
        label_key: format!("replacement.{id}"),
        enabled,
        visible: true,
    })
}

fn input_map() -> InputMap {
    let repeat_ms = safe(250);
    InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowUp,
                button: er_types::GameButton::Up,
            },
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: er_types::GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Enter,
                button: er_types::GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: repeat_ms,
        repeat_interval_ms: repeat_ms,
    }
}

fn context(sender_seat_id: SeatId) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("replacement-campaign")?,
        run_id: er_types::RunId::new("replacement-campaign-run")?,
        session_epoch: safe(1),
        seat_map_id: "replacement-campaign-seats".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id,
        authority_seat_id: seat(0),
        connection_generation: generation(0),
    })
}

fn replacement_menu(
    operation_id: OperationId,
    control_id: String,
    owner_seat_id: SeatId,
    options: Vec<MenuOption>,
    cursor: u64,
) -> UiState {
    UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: Some(owner_seat_id),
        actionable: true,
        stack: vec![MenuState::Replacement(ReplacementMenu {
            operation_id,
            control_id,
            field_index: safe(0),
            cursor: safe(cursor),
            options,
            cancel: CancelPolicy::Disabled,
        })],
    }
}

fn replacement_payload(
    operation_id: &OperationId,
    owner_seat_id: SeatId,
    occurrence: u64,
    selected_party: &str,
) -> Value {
    json!({
        "sourceAddress": {
            "operationId": operation_id.as_str(),
            "ownerSeatId": owner_seat_id,
            "epoch": 1,
            "wave": 1,
            "turn": 1,
            "occurrence": occurrence,
            "fieldIndex": 0,
        },
        "selectedParty": selected_party,
    })
}

fn replacement_plan(
    control_id: String,
    operation_id: OperationId,
    owner_seat_id: SeatId,
    options: Vec<MenuOption>,
    proposals: Vec<MenuProposalPlan>,
) -> ControlMenuPlan {
    ControlMenuPlan::Replacement {
        control_id,
        owner_seat_id,
        operation_id,
        field_index: safe(0),
        options,
        proposals,
        cancel: CancelPolicy::Disabled,
    }
}

fn campaign_config(seed: u64) -> TestResult<(SimulatedPairConfig, ReplacementIds)> {
    let host = seat(0);
    let guest = seat(1);
    let head_operation = operation("replacement/head")?;
    let tail_operation = operation("replacement/tail")?;

    let head_control = er_types::NextControl::Replacement(ReplacementControl {
        operation_id: head_operation.clone(),
        owner_seat_id: guest,
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        occurrence: safe(0),
        field_index: safe(0),
        remaining: vec![ReplacementControlAddress {
            operation_id: tail_operation.clone(),
            owner_seat_id: host,
            epoch: safe(1),
            wave: safe(1),
            turn: safe(1),
            occurrence: safe(1),
            field_index: safe(0),
        }],
    });
    let tail_control = er_types::NextControl::Replacement(ReplacementControl {
        operation_id: tail_operation.clone(),
        owner_seat_id: host,
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        occurrence: safe(1),
        field_index: safe(0),
        remaining: Vec::new(),
    });
    let await_control = er_types::NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id: tail_operation.clone(),
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        allowed_kinds: vec![AuthorityEntryKind::TerminalCommit],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: false,
        expected_operation_id: Some(operation("terminal/complete")?),
    });

    let head_control_id = control_id_of(&head_control);
    let tail_control_id = control_id_of(&tail_control);

    let head_options = vec![
        option("party:alpha", true)?,
        option("party:beta", true)?,
        option("party:gamma", true)?,
        option("party:disabled", false)?,
    ];
    let tail_options = vec![option("party:alpha", true)?, option("party:beta", true)?];
    let head_choice = head_options[1].id.clone();
    let tail_choice = tail_options[0].id.clone();

    let head_plans = vec![
        MenuProposalPlan {
            option_id: head_options[0].id.clone(),
            fingerprint: "replacement/head/party-alpha".to_owned(),
            payload: json!({"party": "party:alpha"}),
        },
        MenuProposalPlan {
            option_id: head_options[1].id.clone(),
            fingerprint: HEAD_FINGERPRINT.to_owned(),
            payload: json!({"party": "party:beta"}),
        },
        MenuProposalPlan {
            option_id: head_options[2].id.clone(),
            fingerprint: "replacement/head/party-gamma".to_owned(),
            payload: json!({"party": "party:gamma"}),
        },
        MenuProposalPlan {
            option_id: head_options[3].id.clone(),
            fingerprint: "replacement/head/disabled".to_owned(),
            payload: json!({"party": "party:disabled"}),
        },
    ];
    let tail_plans = vec![
        MenuProposalPlan {
            option_id: tail_options[0].id.clone(),
            fingerprint: TAIL_FINGERPRINT.to_owned(),
            payload: json!({"party": "party:alpha"}),
        },
        MenuProposalPlan {
            option_id: tail_options[1].id.clone(),
            fingerprint: "replacement/tail/party-beta".to_owned(),
            payload: json!({"party": "party:beta"}),
        },
    ];
    let menu_plans = vec![
        replacement_plan(
            head_control_id.clone(),
            head_operation.clone(),
            guest,
            head_options.clone(),
            head_plans,
        ),
        replacement_plan(
            tail_control_id.clone(),
            tail_operation.clone(),
            host,
            tail_options.clone(),
            tail_plans,
        ),
    ];

    let authority_context = context(host)?;
    let replica_context = context(guest)?;
    let head_draft = AuthorityEntryDraft {
        context: authority_context.clone(),
        operation_id: head_operation.clone(),
        kind: AuthorityEntryKind::ReplacementCommit,
        material: Material {
            digest: "replacement-material/head".to_owned(),
            payload: replacement_payload(&head_operation, guest, 0, "party:beta"),
        },
        next_control: tail_control.clone(),
        subsumes: Vec::new(),
    };
    let tail_draft = AuthorityEntryDraft {
        context: authority_context.clone(),
        operation_id: tail_operation.clone(),
        kind: AuthorityEntryKind::ReplacementCommit,
        material: Material {
            digest: "replacement-material/tail".to_owned(),
            payload: replacement_payload(&tail_operation, host, 1, "party:alpha"),
        },
        next_control: await_control,
        subsumes: Vec::new(),
    };

    let host_kernel = KernelConfig {
        input_map: input_map(),
        // Both endpoints render the same control, but only the guest owns this
        // head. The host press below therefore exercises the raw wrong-seat path.
        initial_ui: replacement_menu(
            head_operation.clone(),
            head_control_id.clone(),
            guest,
            head_options.clone(),
            3,
        ),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: AuthorityLogConfig {
                    local_context: authority_context,
                    peer_bindings: vec![PeerBinding {
                        seat_id: guest,
                        connection_generation: generation(0),
                    }],
                    owner_id: "replacement-campaign:authority".to_owned(),
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
                proposal_capacity: safe(64),
                resolutions: vec![
                    AuthorityResolutionPlan {
                        operation_id: head_operation.clone(),
                        fingerprint: HEAD_FINGERPRINT.to_owned(),
                        draft: head_draft,
                    },
                    AuthorityResolutionPlan {
                        operation_id: tail_operation.clone(),
                        fingerprint: TAIL_FINGERPRINT.to_owned(),
                        draft: tail_draft,
                    },
                ],
            },
            menu_plans: menu_plans.clone(),
        }),
    };
    let guest_kernel = KernelConfig {
        input_map: input_map(),
        initial_ui: replacement_menu(
            head_operation.clone(),
            head_control_id.clone(),
            guest,
            head_options,
            3,
        ),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: replica_context.clone(),
                    authority_seat_id: host,
                    authority_connection_generation: generation(0),
                },
                proposal_leases: ProposalLeaseConfig {
                    owner_prefix: "replacement-campaign:proposal:".to_owned(),
                    retry_initial_ms: safe(250),
                    retry_maximum_ms: safe(5_000),
                    absolute_ceiling_ms: safe(1_200_000),
                },
                recovery: RecoveryTransactionConfig {
                    local_context: replica_context,
                    request_timeout_ms: safe(300_000),
                    control_timeout_ms: safe(30_000),
                    pacing_ms: safe(16),
                    timer_owner_id: "replacement-campaign:recovery".to_owned(),
                },
            },
            menu_plans,
        }),
    };

    Ok((
        SimulatedPairConfig {
            host_kernel,
            guest_kernel,
            host_seat: host,
            guest_seat: guest,
            seed,
            presenter: PresenterMode::Instant,
            initial_storage: BTreeMap::new(),
            event_budget: safe(2_048),
        },
        ReplacementIds {
            host,
            guest,
            head_operation,
            tail_operation,
            head_control_id,
            tail_control_id,
            head_choice,
            tail_choice,
        },
    ))
}

fn endpoint_snapshot(snapshot: &PairSnapshot, endpoint: PairEndpoint) -> &er_sim::EndpointSnapshot {
    match endpoint {
        PairEndpoint::Host => &snapshot.host,
        PairEndpoint::Guest => &snapshot.guest,
    }
}

fn selected_option(snapshot: &PairSnapshot, endpoint: PairEndpoint) -> Option<String> {
    endpoint_snapshot(snapshot, endpoint)
        .ui
        .options
        .iter()
        .find(|option| option.selected)
        .map(|option| option.id.as_str().to_owned())
}

fn has_ui_intent(step: &PairStep, endpoint: SeatId) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                ..
            } if *effect_endpoint == endpoint
        )
    })
}

fn assert_no_ui_intent(steps: &[PairStep], endpoint: SeatId, reason: &str) {
    assert!(
        steps.iter().all(|step| !has_ui_intent(step, endpoint)),
        "{reason}"
    );
}

fn assert_replacement_intent(
    steps: &[PairStep],
    endpoint: SeatId,
    operation_id: &OperationId,
    control_id: &str,
    option_id: &MenuOptionId,
) {
    assert!(
        steps.iter().any(|step| {
            step.generated_effects.iter().any(|effect| {
                matches!(
                    effect,
                    KernelEffect::UiIntent {
                        endpoint: effect_endpoint,
                        intent: UiIntent::ReplacementSubmitted {
                            seat,
                            operation_id: intent_operation,
                            control_id: intent_control,
                            option_id: intent_option,
                            ..
                        },
                    } if *effect_endpoint == endpoint
                        && *seat == endpoint
                        && intent_operation.as_str() == operation_id.as_str()
                        && intent_control.as_str() == control_id
                        && intent_option == option_id
                )
            })
        }),
        "raw replacement submission lost its operation/control/party identity"
    );
}

fn delay_queued_packets(
    pair: &mut SimulatedPair,
    trace: &mut Vec<PairStep>,
    additional_ms: SafeU53,
) -> TestResult<Vec<SafeU53>> {
    let packet_ids = pair
        .snapshot()?
        .network
        .queued_packet_ids
        .iter()
        .copied()
        .collect::<Vec<_>>();
    if packet_ids.is_empty() {
        return Err("replacement submission did not create a network packet".into());
    }
    for packet_id in &packet_ids {
        let step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id: *packet_id,
                additional_ms,
            },
        })?;
        trace.push(step);
    }
    Ok(packet_ids)
}

fn deliver_all_queued(pair: &mut SimulatedPair, trace: &mut Vec<PairStep>) -> TestResult {
    for _ in 0..64 {
        let Some(packet_id) = pair
            .snapshot()?
            .network
            .queued_packet_ids
            .iter()
            .next()
            .copied()
        else {
            return Ok(());
        };
        let step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver { packet_id },
        })?;
        trace.push(step);
    }
    Err("replacement campaign did not quiesce while delivering queued packets".into())
}

fn run_campaign(seed: u64) -> TestResult<CampaignRun> {
    let (config, ids) = campaign_config(seed)?;
    let mut pair = SimulatedPair::new(config)?;
    let mut trace = Vec::new();

    let initial = pair.snapshot()?;
    assert_eq!(initial.host.ui.kind, UiViewKind::Replacement);
    assert_eq!(initial.host.ui.owner_seat, Some(ids.guest));
    assert_eq!(initial.guest.ui.owner_seat, Some(ids.guest));
    assert_eq!(selected_option(&initial, PairEndpoint::Guest).as_deref(), Some("party:disabled"));

    let wrong_seat = pair.press(PairEndpoint::Host, PhysicalKey::Enter)?;
    assert_no_ui_intent(&wrong_seat, ids.host, "non-owner host input must be rejected");
    trace.extend(wrong_seat.iter().cloned());
    assert_eq!(pair.snapshot()?.host.ui, initial.host.ui);

    let disabled = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_no_ui_intent(&disabled, ids.guest, "disabled party input must be rejected");
    trace.extend(disabled.iter().cloned());
    assert_eq!(pair.snapshot()?.guest.ui, initial.guest.ui);

    let first_move = pair.press(PairEndpoint::Guest, PhysicalKey::ArrowUp)?;
    trace.extend(first_move.iter().cloned());
    assert_eq!(
        selected_option(
            &first_move
                .last()
                .ok_or_else(|| std::io::Error::other("missing move"))?
                .snapshot,
            PairEndpoint::Guest,
        )
            .as_deref(),
        Some("party:gamma")
    );

    // Keep the physical key held so its repeat carries the old menu generation
    // across the delayed control transition and is rejected as stale.
    let held_move = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowUp, false)?;
    trace.push(held_move.clone());
    assert_eq!(selected_option(&held_move.snapshot, PairEndpoint::Guest).as_deref(), Some("party:beta"));

    let head_submit = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_replacement_intent(
        &head_submit,
        ids.guest,
        &ids.head_operation,
        &ids.head_control_id,
        &ids.head_choice,
    );
    trace.extend(head_submit.iter().cloned());
    delay_queued_packets(&mut pair, &mut trace, safe(1_000))?;

    let delayed_head = pair.advance_time(safe(100))?;
    trace.push(delayed_head);
    assert!(!pair.snapshot()?.network.queued_packet_ids.is_empty());
    deliver_all_queued(&mut pair, &mut trace)?;

    let tail_ready = pair.snapshot()?;
    assert_eq!(tail_ready.host.ui.kind, UiViewKind::Replacement);
    assert_eq!(tail_ready.host.ui.owner_seat, Some(ids.host));
    assert_eq!(
        selected_option(&tail_ready, PairEndpoint::Host).as_deref(),
        Some("party:alpha")
    );

    let before_stale = pair.snapshot()?;
    let stale_repeat = pair.advance_time(safe(250))?;
    trace.push(stale_repeat.clone());
    assert_eq!(stale_repeat.snapshot.guest.ui, before_stale.guest.ui);
    assert_no_ui_intent(
        std::slice::from_ref(&stale_repeat),
        ids.guest,
        "a repeat from the pre-control menu must not create a UI intent",
    );

    let released = pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowUp)?;
    trace.push(released);

    let tail_wrong_seat = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_no_ui_intent(
        &tail_wrong_seat,
        ids.guest,
        "guest input must not submit the host-owned replacement",
    );
    trace.extend(tail_wrong_seat.iter().cloned());

    let tail_submit = pair.press(PairEndpoint::Host, PhysicalKey::Enter)?;
    assert_replacement_intent(
        &tail_submit,
        ids.host,
        &ids.tail_operation,
        &ids.tail_control_id,
        &ids.tail_choice,
    );
    trace.extend(tail_submit.iter().cloned());
    delay_queued_packets(&mut pair, &mut trace, safe(1_000))?;
    let delayed_tail = pair.advance_time(safe(100))?;
    trace.push(delayed_tail);
    deliver_all_queued(&mut pair, &mut trace)?;

    let converged = pair.snapshot()?;
    assert_eq!(converged.host.ui, converged.guest.ui);
    assert_eq!(converged.host.ui.kind, UiViewKind::Waiting);
    assert_eq!(converged.host.ui.owner_seat, None);
    assert!(converged.network.queued_packet_ids.is_empty());

    let final_snapshot = pair.teardown("replacement campaign complete")?;
    assert!(final_snapshot.network.queued_packet_ids.is_empty());
    assert!(final_snapshot.host.live_resources.timers.is_empty());
    assert!(final_snapshot.guest.live_resources.timers.is_empty());
    assert!(final_snapshot.host.live_resources.proposal_leases.is_empty());
    assert!(final_snapshot.guest.live_resources.proposal_leases.is_empty());

    Ok(CampaignRun {
        trace,
        final_snapshot,
    })
}

#[test]
fn delayed_asymmetric_replacement_campaign_is_raw_and_deterministically_convergent() -> TestResult {
    let first = run_campaign(0x5eed_cafe)?;
    let second = run_campaign(0x5eed_cafe)?;

    assert_eq!(first.trace, second.trace);
    assert_eq!(first.final_snapshot, second.final_snapshot);
    Ok(())
}
