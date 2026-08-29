use std::collections::BTreeMap;
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, KernelEffect, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AckStage, AuthorityEntryBody, AuthorityEntryDraft, AuthorityEntryKind, AuthorityLogConfig,
    AuthorityReceiptBody, AuthorityReplicaConfig, BackoffPolicy, FrameContext, FrameType, Material,
    PeerBinding, ProposalFingerprintInput, ProposalJson, ProposalLeaseConfig,
    RecoveryTransactionConfig, SafeI53, control_id_of, proposal_fingerprint,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig, SimulatedPairError,
};
use er_types::{
    AwaitSuccessorControl, CancelPolicy, ConnectionGeneration, FRAME_PROTOCOL_VERSION, GameButton,
    InputFocus, InputMap, KeyBinding, LiveResourceSnapshot, MembershipRevision, MenuGeneration,
    MenuOption, MenuOptionId, MenuState, NextControl, OperationId, PhysicalKey,
    PresentationEventId, ProposalMessage, RawInputEvent, ReplacementControl,
    ReplacementControlAddress, ReplacementMenu, Revision, SafeU53, SeatId, SessionId, TimeClass,
    TimerOwner, UiIntent, UiState, UiViewKind,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const DETERMINISTIC_EXECUTIONS: usize = 250;

#[derive(Clone, Debug)]
struct ReplacementIds {
    host: SeatId,
    guest: SeatId,
    head_operation: OperationId,
    tail_operation: OperationId,
    head_control_id: String,
    tail_control_id: String,
    await_control_id: String,
    head_fingerprint: String,
    head_proposal_payload: Value,
    head_material: Material,
    tail_material: Material,
    head_next_control: NextControl,
    tail_next_control: NextControl,
    head_choice: MenuOptionId,
    tail_choice: MenuOptionId,
}

struct ReplacementFingerprints {
    head_alpha: String,
    head_beta: String,
    head_gamma: String,
    head_disabled: String,
    tail_alpha: String,
    tail_beta: String,
}

struct CampaignRun {
    trace: Vec<PairStep>,
    final_snapshot: PairSnapshot,
}

struct ReplacementMenuExpectation<'a> {
    endpoint: PairEndpoint,
    owner: SeatId,
    generation: MenuGeneration,
    operation_id: &'a OperationId,
    control_id: &'a str,
    field_index: SafeU53,
    cursor: SafeU53,
    option_id: &'a MenuOptionId,
}

struct ReplacementIntentExpectation<'a> {
    menu: ReplacementMenuExpectation<'a>,
    endpoint: SeatId,
}

struct AuthorityChainContext<'a> {
    authority_context: &'a FrameContext,
    replica_context: &'a FrameContext,
    authority_seat: SeatId,
    replica_seat: SeatId,
}

struct AuthorityChainExpectation<'a> {
    operation_id: &'a OperationId,
    revision_value: u64,
    material: &'a Material,
    next_control: &'a NextControl,
    expected_control_id: &'a str,
    context: AuthorityChainContext<'a>,
    prior_frontier: (u64, u64, u64),
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

fn replacement_fingerprints() -> TestResult<ReplacementFingerprints> {
    let head_alpha = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(1),
        label: "replacement/head".to_owned(),
        choice: SafeI53::new(0)?,
        wire: Some(ProposalJson::new(r#"{"party":"party:alpha"}"#)?),
        reward_surface: Some(ProposalJson::new(
            r#"{"party":"party:alpha","surface":"replacement"}"#,
        )?),
    })?;
    let head_beta = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(1),
        label: "replacement/head".to_owned(),
        choice: SafeI53::new(1)?,
        wire: Some(ProposalJson::new(r#"{"party":"party:beta"}"#)?),
        reward_surface: Some(ProposalJson::new(
            r#"{"party":"party:beta","surface":"replacement"}"#,
        )?),
    })?;
    let head_gamma = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(1),
        label: "replacement/head".to_owned(),
        choice: SafeI53::new(2)?,
        wire: Some(ProposalJson::new(r#"{"party":"party:gamma"}"#)?),
        reward_surface: Some(ProposalJson::new(
            r#"{"party":"party:gamma","surface":"replacement"}"#,
        )?),
    })?;
    let head_disabled = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(1),
        label: "replacement/head".to_owned(),
        choice: SafeI53::new(3)?,
        wire: Some(ProposalJson::new(r#"{"party":"party:disabled"}"#)?),
        reward_surface: Some(ProposalJson::new(
            r#"{"party":"party:disabled","surface":"replacement"}"#,
        )?),
    })?;
    let tail_alpha = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(2),
        label: "replacement/tail".to_owned(),
        choice: SafeI53::new(0)?,
        wire: Some(ProposalJson::new(r#"{"party":"party:alpha"}"#)?),
        reward_surface: Some(ProposalJson::new(
            r#"{"party":"party:alpha","surface":"replacement"}"#,
        )?),
    })?;
    let tail_beta = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(2),
        label: "replacement/tail".to_owned(),
        choice: SafeI53::new(1)?,
        wire: Some(ProposalJson::new(r#"{"party":"party:beta"}"#)?),
        reward_surface: Some(ProposalJson::new(
            r#"{"party":"party:beta","surface":"replacement"}"#,
        )?),
    })?;

    assert_eq!(
        head_alpha,
        r#"[1,"replacement/head",0,{"party":"party:alpha"},{"party":"party:alpha","surface":"replacement"}]"#,
    );
    assert_eq!(
        head_beta,
        r#"[1,"replacement/head",1,{"party":"party:beta"},{"party":"party:beta","surface":"replacement"}]"#,
    );
    assert_eq!(
        head_gamma,
        r#"[1,"replacement/head",2,{"party":"party:gamma"},{"party":"party:gamma","surface":"replacement"}]"#,
    );
    assert_eq!(
        head_disabled,
        r#"[1,"replacement/head",3,{"party":"party:disabled"},{"party":"party:disabled","surface":"replacement"}]"#,
    );
    assert_eq!(
        tail_alpha,
        r#"[2,"replacement/tail",0,{"party":"party:alpha"},{"party":"party:alpha","surface":"replacement"}]"#,
    );
    assert_eq!(
        tail_beta,
        r#"[2,"replacement/tail",1,{"party":"party:beta"},{"party":"party:beta","surface":"replacement"}]"#,
    );

    Ok(ReplacementFingerprints {
        head_alpha,
        head_beta,
        head_gamma,
        head_disabled,
        tail_alpha,
        tail_beta,
    })
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
    let await_control_id = control_id_of(&await_control);

    let head_options = vec![
        option("party:alpha", true)?,
        option("party:beta", true)?,
        option("party:gamma", true)?,
        option("party:disabled", false)?,
    ];
    let tail_options = vec![option("party:alpha", true)?, option("party:beta", true)?];
    let head_choice = head_options[1].id.clone();
    let tail_choice = tail_options[0].id.clone();
    let fingerprints = replacement_fingerprints()?;
    let head_fingerprint = fingerprints.head_beta.clone();
    let tail_fingerprint = fingerprints.tail_alpha.clone();
    let head_proposal_payload = json!({"party": "party:beta"});
    let tail_proposal_payload = json!({"party": "party:alpha"});

    let head_plans = vec![
        MenuProposalPlan {
            option_id: head_options[0].id.clone(),
            fingerprint: fingerprints.head_alpha.clone(),
            payload: json!({"party": "party:alpha"}),
        },
        MenuProposalPlan {
            option_id: head_options[1].id.clone(),
            fingerprint: head_fingerprint.clone(),
            payload: head_proposal_payload.clone(),
        },
        MenuProposalPlan {
            option_id: head_options[2].id.clone(),
            fingerprint: fingerprints.head_gamma.clone(),
            payload: json!({"party": "party:gamma"}),
        },
        MenuProposalPlan {
            option_id: head_options[3].id.clone(),
            fingerprint: fingerprints.head_disabled.clone(),
            payload: json!({"party": "party:disabled"}),
        },
    ];
    let tail_plans = vec![
        MenuProposalPlan {
            option_id: tail_options[0].id.clone(),
            fingerprint: tail_fingerprint.clone(),
            payload: tail_proposal_payload.clone(),
        },
        MenuProposalPlan {
            option_id: tail_options[1].id.clone(),
            fingerprint: fingerprints.tail_beta.clone(),
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
    let head_material = Material {
        digest: "replacement-material/head".to_owned(),
        payload: replacement_payload(&head_operation, guest, 0, "party:beta"),
    };
    let tail_material = Material {
        digest: "replacement-material/tail".to_owned(),
        payload: replacement_payload(&tail_operation, host, 1, "party:alpha"),
    };
    let head_draft = AuthorityEntryDraft {
        context: authority_context.clone(),
        operation_id: head_operation.clone(),
        kind: AuthorityEntryKind::ReplacementCommit,
        material: head_material.clone(),
        next_control: tail_control.clone(),
        subsumes: Vec::new(),
    };
    let tail_draft = AuthorityEntryDraft {
        context: authority_context.clone(),
        operation_id: tail_operation.clone(),
        kind: AuthorityEntryKind::ReplacementCommit,
        material: tail_material.clone(),
        next_control: await_control.clone(),
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
                        fingerprint: head_fingerprint.clone(),
                        draft: head_draft,
                    },
                    AuthorityResolutionPlan {
                        operation_id: tail_operation.clone(),
                        fingerprint: tail_fingerprint.clone(),
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
            await_control_id,
            head_fingerprint,
            head_proposal_payload,
            head_material,
            tail_material,
            head_next_control: tail_control,
            tail_next_control: await_control,
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

fn assert_replacement_menu(
    snapshot: &PairSnapshot,
    expected: &ReplacementMenuExpectation<'_>,
) -> TestResult {
    let endpoint_snapshot = endpoint_snapshot(snapshot, expected.endpoint);
    assert_eq!(endpoint_snapshot.kernel.ui.generation, expected.generation);
    assert_eq!(endpoint_snapshot.kernel.ui.owner_seat, Some(expected.owner));
    assert!(endpoint_snapshot.kernel.ui.actionable);
    let stack = endpoint_snapshot.kernel.ui.stack.as_slice();
    let [MenuState::Replacement(menu)] = stack else {
        return Err(std::io::Error::other(format!(
            "expected one replacement menu, found {stack:?}"
        ))
        .into());
    };
    let enabled_visible_options = menu
        .options
        .iter()
        .filter(|option| option.enabled && option.visible)
        .count();
    assert!(
        enabled_visible_options >= 2,
        "replacement menu must have at least two enabled visible options, found {enabled_visible_options}"
    );
    assert_eq!(&menu.operation_id, expected.operation_id);
    assert_eq!(&menu.control_id, expected.control_id);
    assert_eq!(menu.field_index, expected.field_index);
    assert_eq!(menu.cursor, expected.cursor);
    let cursor_index = usize::try_from(expected.cursor.get())?;
    let selected_option = menu.options.get(cursor_index).ok_or_else(|| {
        std::io::Error::other(format!(
            "replacement cursor {:?} has no menu option",
            expected.cursor
        ))
    })?;
    assert_eq!(&selected_option.id, expected.option_id);
    Ok(())
}

fn assert_cursor_intent(
    steps: &[PairStep],
    endpoint: SeatId,
    generation: MenuGeneration,
    cursor: SafeU53,
) {
    let intents = steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent:
                    UiIntent::CursorChanged {
                        seat,
                        generation: intent_generation,
                        cursor: intent_cursor,
                    },
            } if *effect_endpoint == endpoint => Some((*seat, *intent_generation, *intent_cursor)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        intents,
        vec![(endpoint, generation, cursor)],
        "cursor intent lost seat, menu generation, or cursor identity"
    );
}

fn assert_replacement_intent(
    steps: &[PairStep],
    pre_submission: &PairSnapshot,
    expected: &ReplacementIntentExpectation<'_>,
) -> TestResult {
    assert_replacement_menu(pre_submission, &expected.menu)?;

    let intents = steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent:
                    UiIntent::ReplacementSubmitted {
                        seat,
                        generation: intent_generation,
                        operation_id: intent_operation,
                        control_id: intent_control,
                        option_id: intent_option,
                    },
            } if *effect_endpoint == expected.endpoint => Some((
                *seat,
                *intent_generation,
                intent_operation.clone(),
                intent_control.clone(),
                intent_option.clone(),
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        intents,
        vec![(
            expected.endpoint,
            expected.menu.generation,
            expected.menu.operation_id.clone(),
            expected.menu.control_id.to_owned(),
            expected.menu.option_id.clone(),
        )],
        "raw replacement submission lost its seat/menu/operation/control/party identity"
    );
    Ok(())
}

fn assert_no_replacement_submission(steps: &[PairStep], endpoint: SeatId, reason: &str) {
    assert!(
        steps
            .iter()
            .flat_map(|step| step.generated_effects.iter())
            .all(|effect| {
                !matches!(
                    effect,
                    KernelEffect::UiIntent {
                        endpoint: effect_endpoint,
                        intent: UiIntent::ReplacementSubmitted { .. },
                    } if *effect_endpoint == endpoint
                )
            }),
        "{reason}"
    );
}

fn proposal_effects(steps: &[PairStep]) -> Vec<ProposalMessage> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect()
}

fn effect_locations<F>(steps: &[PairStep], mut predicate: F) -> Vec<(usize, usize)>
where
    F: FnMut(&KernelEffect) -> bool,
{
    steps
        .iter()
        .enumerate()
        .flat_map(|(step_index, step)| {
            step.generated_effects
                .iter()
                .enumerate()
                .filter_map(|(effect_index, effect)| {
                    predicate(effect).then_some((step_index, effect_index))
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[derive(Clone, Debug)]
struct ReceiptEvent {
    step_index: usize,
    effect_index: usize,
    from: SeatId,
    context: FrameContext,
    body: AuthorityReceiptBody,
}

fn receipt_events(
    steps: &[PairStep],
    revision: Revision,
    operation_id: &OperationId,
) -> TestResult<Vec<ReceiptEvent>> {
    let mut receipts = Vec::new();
    for (step_index, step) in steps.iter().enumerate() {
        for (effect_index, effect) in step.generated_effects.iter().enumerate() {
            let KernelEffect::SendFrame { from, frame } = effect else {
                continue;
            };
            if frame.frame_type != FrameType::AuthorityReceipt {
                continue;
            }
            let body = serde_json::from_value::<AuthorityReceiptBody>(frame.body.clone())?;
            if body.revision == revision && &body.operation_id == operation_id {
                receipts.push(ReceiptEvent {
                    step_index,
                    effect_index,
                    from: *from,
                    context: frame.context.clone(),
                    body,
                });
            }
        }
    }
    Ok(receipts)
}

fn find_frontier(value: &Value) -> Option<(u64, u64, u64)> {
    match value {
        Value::Object(object) => {
            if let (Some(received), Some(material), Some(control)) = (
                object.get("received").and_then(Value::as_u64),
                object.get("material").and_then(Value::as_u64),
                object.get("control").and_then(Value::as_u64),
            ) {
                return Some((received, material, control));
            }
            object.values().find_map(find_frontier)
        }
        Value::Array(values) => values.iter().find_map(find_frontier),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => None,
    }
}

fn guest_frontier(step: &PairStep) -> TestResult<(u64, u64, u64)> {
    find_frontier(&step.snapshot.guest.kernel.state).ok_or_else(|| {
        std::io::Error::other("replica frontier was not retained in the step snapshot").into()
    })
}

fn assert_authority_chain(
    steps: &[PairStep],
    expected: &AuthorityChainExpectation<'_>,
) -> TestResult {
    let operation_id = expected.operation_id;
    let revision_value = expected.revision_value;
    let material = expected.material;
    let next_control = expected.next_control;
    let expected_control_id = expected.expected_control_id;
    let authority_context = expected.context.authority_context;
    let replica_context = expected.context.replica_context;
    let authority_seat = expected.context.authority_seat;
    let replica_seat = expected.context.replica_seat;
    let prior_frontier = expected.prior_frontier;
    let revision = Revision::new(safe(revision_value));
    let expected_entry = AuthorityEntryBody {
        revision,
        operation_id: operation_id.clone(),
        kind: AuthorityEntryKind::ReplacementCommit,
        material: material.clone(),
        next_control: next_control.clone(),
        subsumes: Vec::new(),
    };

    let entry_candidates = effect_locations(steps, |effect| {
        matches!(
            effect,
            KernelEffect::SendFrame { from, frame }
                if *from == authority_seat && frame.frame_type == FrameType::AuthorityEntry
        )
    });
    let expected_entry_body = serde_json::to_value(&expected_entry)?;
    let mut entry_locations = Vec::new();
    for location in entry_candidates {
        let effect = &steps[location.0].generated_effects[location.1];
        let KernelEffect::SendFrame { frame, .. } = effect else {
            continue;
        };
        let body = serde_json::from_value::<AuthorityEntryBody>(frame.body.clone())?;
        if body.revision == revision && &body.operation_id == operation_id {
            assert_eq!(frame.version, FRAME_PROTOCOL_VERSION);
            assert_eq!(&frame.context, authority_context);
            assert_eq!(&frame.body, &expected_entry_body);
            assert_eq!(body, expected_entry);
            entry_locations.push(location);
        }
    }
    let Some(entry_location) = entry_locations.first().copied() else {
        return Err("authority did not emit a fully identified replacement entry".into());
    };
    assert_eq!(guest_frontier(&steps[entry_location.0])?, prior_frontier);

    let material_locations = effect_locations(steps, |effect| {
        matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial {
                endpoint,
                revision: effect_revision,
                operation_id: effect_operation,
                material: effect_material,
            } if *endpoint == replica_seat
                && *effect_revision == revision
                && effect_operation == operation_id
                && effect_material == material
        )
    });
    let Some(material_location) = material_locations.first().copied() else {
        return Err("replacement material identity was not applied".into());
    };
    assert_eq!(
        material_locations.len(),
        1,
        "replacement material identity was not applied exactly once"
    );

    let control_locations = effect_locations(steps, |effect| {
        matches!(
            effect,
            KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision: effect_revision,
                operation_id: effect_operation,
                control: effect_control,
            } if *endpoint == replica_seat
                && *effect_revision == revision
                && effect_operation == operation_id
                && effect_control == next_control
        )
    });
    let Some(control_location) = control_locations.first().copied() else {
        return Err("replacement control identity was not projected".into());
    };
    assert_eq!(
        control_locations.len(),
        1,
        "replacement control identity was not projected exactly once"
    );
    let control_effect = &steps[control_location.0].generated_effects[control_location.1];
    let KernelEffect::ProjectAuthorityControl { control, .. } = control_effect else {
        return Err(std::io::Error::other(
            "control location did not point to ProjectAuthorityControl",
        )
        .into());
    };
    assert_eq!(control_id_of(control), expected_control_id);

    let presentation_locations = effect_locations(steps, |effect| {
        matches!(
            effect,
            KernelEffect::Present { endpoint, event }
                if *endpoint == replica_seat
                    && event.event_id == PresentationEventId::new(revision.get())
        )
    });
    let Some(presentation_location) = presentation_locations.first().copied() else {
        return Err("replacement presentation identity was not requested".into());
    };
    assert_eq!(
        presentation_locations.len(),
        1,
        "replacement presentation identity was requested exactly once"
    );

    let receipts = receipt_events(steps, revision, operation_id)?;
    assert!(
        receipts.len() >= 4,
        "replacement receipt chain is missing one or more mechanical receipts"
    );
    for receipt in &receipts {
        assert_eq!(receipt.from, replica_seat);
        assert_eq!(&receipt.context, replica_context);
        assert_eq!(receipt.context.sender_seat_id, replica_seat);
        assert_eq!(receipt.context.authority_seat_id, authority_seat);
        assert_eq!(receipt.context.connection_generation, generation(0));
    }

    let stages = receipts
        .iter()
        .map(|receipt| receipt.body.stage)
        .collect::<Vec<_>>();
    let Some(first_stages) = stages.get(..4) else {
        return Err("replacement receipt chain has fewer than four stages".into());
    };
    assert_eq!(
        first_stages,
        &[
            AckStage::Admitted,
            AckStage::MaterialApplied,
            AckStage::ControlInstalled,
            AckStage::PresentationSettled,
        ],
        "replacement receipt chain did not settle its first presentation: {stages:?}"
    );
    let Some(replay_stages) = stages.get(4..) else {
        return Err("replacement receipt replay slice is unavailable".into());
    };
    if !replay_stages.is_empty() {
        assert_eq!(replay_stages.len() % 2, 0);
        for replay in replay_stages.chunks(2) {
            let [control_stage, presentation_stage] = replay else {
                return Err("replacement receipt replay was not a pair".into());
            };
            assert_eq!(
                [*control_stage, *presentation_stage],
                [AckStage::ControlInstalled, AckStage::PresentationSettled]
            );
        }
    }
    let expected_receipts = [
        AuthorityReceiptBody {
            revision,
            operation_id: operation_id.clone(),
            stage: AckStage::Admitted,
            control_id: None,
        },
        AuthorityReceiptBody {
            revision,
            operation_id: operation_id.clone(),
            stage: AckStage::MaterialApplied,
            control_id: None,
        },
        AuthorityReceiptBody {
            revision,
            operation_id: operation_id.clone(),
            stage: AckStage::ControlInstalled,
            control_id: Some(expected_control_id.to_owned()),
        },
    ];
    for (receipt, expected) in receipts.iter().take(3).zip(expected_receipts.iter()) {
        assert_eq!(&receipt.body, expected);
    }
    if let Some(receipt) = receipts.get(3) {
        assert_eq!(
            receipt.body,
            AuthorityReceiptBody {
                revision,
                operation_id: operation_id.clone(),
                stage: AckStage::PresentationSettled,
                control_id: None,
            }
        );
    }
    let Some(replay_receipts) = receipts.get(4..) else {
        return Err("replacement receipt replay slice is unavailable".into());
    };
    for replay in replay_receipts.chunks(2) {
        let [control_receipt, presentation_receipt] = replay else {
            return Err("replacement receipt replay was not a pair".into());
        };
        assert_eq!(
            control_receipt.body,
            AuthorityReceiptBody {
                revision,
                operation_id: operation_id.clone(),
                stage: AckStage::ControlInstalled,
                control_id: Some(expected_control_id.to_owned()),
            }
        );
        assert_eq!(
            presentation_receipt.body,
            AuthorityReceiptBody {
                revision,
                operation_id: operation_id.clone(),
                stage: AckStage::PresentationSettled,
                control_id: None,
            }
        );
    }

    let Some(admitted_receipt) = receipts.first() else {
        return Err("replacement receipt chain has no admitted receipt".into());
    };
    let Some(material_receipt) = receipts.get(1) else {
        return Err("replacement receipt chain has no material receipt".into());
    };
    let Some(control_receipt) = receipts.get(2) else {
        return Err("replacement receipt chain has no control receipt".into());
    };
    let Some(presentation_receipt) = receipts.get(3) else {
        return Err("replacement receipt chain has no presentation receipt".into());
    };
    let admitted_location = (admitted_receipt.step_index, admitted_receipt.effect_index);
    let material_receipt_location = (material_receipt.step_index, material_receipt.effect_index);
    let control_receipt_location = (control_receipt.step_index, control_receipt.effect_index);
    let presentation_receipt_location = (
        presentation_receipt.step_index,
        presentation_receipt.effect_index,
    );
    assert!(entry_location < admitted_location);
    assert!(admitted_location < material_location);
    assert!(material_location < material_receipt_location);
    assert!(material_receipt_location < control_location);
    assert!(control_location < control_receipt_location);
    assert!(control_receipt_location < presentation_location);
    assert!(presentation_location < presentation_receipt_location);

    for (boundary, location) in [
        ("admitted", admitted_location),
        ("material", material_location),
        ("materialApplied", material_receipt_location),
        ("control", control_location),
        ("controlInstalled", control_receipt_location),
    ] {
        let frontier = guest_frontier(&steps[location.0])?;
        assert_eq!(
            frontier.0, revision_value,
            "replica received frontier diverged at {boundary}"
        );
        assert!(
            frontier.0 >= frontier.1 && frontier.1 >= frontier.2,
            "replica frontier order broke at {boundary}: {frontier:?}"
        );
        assert!(frontier.1 >= prior_frontier.1);
        assert!(frontier.2 >= prior_frontier.2);
    }
    assert_eq!(
        guest_frontier(&steps[control_receipt_location.0])?,
        (revision_value, revision_value, revision_value),
        "replica frontier did not reach the installed replacement control"
    );

    Ok(())
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
        assert_eq!(endpoint.live_resources, LiveResourceSnapshot::default());
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
    assert!(snapshot.clock_timers.is_empty());
    assert!(snapshot.network.queued_packet_ids.is_empty());
    assert!(snapshot.network.disconnected_endpoints.is_empty());
    assert!(snapshot.network.suspended_endpoints.is_empty());
    assert!(snapshot.network.disposed);
    assert!(snapshot.presenter.pending_event_ids.is_empty());
    assert!(snapshot.presenter.settled_event_ids.is_empty());
    assert!(snapshot.presenter.disposed);
    assert!(snapshot.storage.keys.is_empty());
    assert!(snapshot.storage.pending_request_ids.is_empty());
    assert!(snapshot.storage.disposed);
}

fn assert_post_disposal_rejected(pair: &mut SimulatedPair) -> TestResult {
    assert!(matches!(
        pair.teardown("replacement campaign repeated teardown"),
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
        pair.advance_time(SafeU53::ZERO),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.press(PairEndpoint::Host, PhysicalKey::Enter),
        Err(SimulatedPairError::Disposed)
    ));
    Ok(())
}

fn run_campaign(seed: u64) -> TestResult<CampaignRun> {
    let (config, ids) = campaign_config(seed)?;
    let mut pair = SimulatedPair::new(config)?;
    let mut trace = Vec::new();

    let initial = pair.snapshot()?;
    let initial_generation = initial.guest.ui.generation;
    assert_eq!(initial.host.ui.kind, UiViewKind::Replacement);
    assert_eq!(initial.host.ui.owner_seat, Some(ids.guest));
    assert_eq!(initial.guest.ui.owner_seat, Some(ids.guest));
    assert_eq!(
        selected_option(&initial, PairEndpoint::Guest).as_deref(),
        Some("party:disabled")
    );
    assert_replacement_menu(
        &initial,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Guest,
            owner: ids.guest,
            generation: initial_generation,
            operation_id: &ids.head_operation,
            control_id: &ids.head_control_id,
            field_index: safe(0),
            cursor: safe(3),
            option_id: &MenuOptionId::new("party:disabled".to_owned())?,
        },
    )?;

    let wrong_seat = pair.press(PairEndpoint::Host, PhysicalKey::Enter)?;
    assert_no_ui_intent(
        &wrong_seat,
        ids.host,
        "non-owner host input must be rejected",
    );
    trace.extend(wrong_seat.iter().cloned());
    assert_eq!(pair.snapshot()?.host.ui, initial.host.ui);

    let disabled = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_no_ui_intent(
        &disabled,
        ids.guest,
        "disabled party input must be rejected",
    );
    trace.extend(disabled.iter().cloned());
    assert_eq!(pair.snapshot()?.guest.ui, initial.guest.ui);

    let first_move = pair.press(PairEndpoint::Guest, PhysicalKey::ArrowUp)?;
    assert_cursor_intent(&first_move, ids.guest, initial_generation, safe(2));
    trace.extend(first_move.iter().cloned());
    let first_move_snapshot = first_move
        .last()
        .ok_or_else(|| std::io::Error::other("missing move"))?
        .snapshot
        .clone();
    assert_replacement_menu(
        &first_move_snapshot,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Guest,
            owner: ids.guest,
            generation: initial_generation,
            operation_id: &ids.head_operation,
            control_id: &ids.head_control_id,
            field_index: safe(0),
            cursor: safe(2),
            option_id: &MenuOptionId::new("party:gamma".to_owned())?,
        },
    )?;
    assert_eq!(
        selected_option(&first_move_snapshot, PairEndpoint::Guest,).as_deref(),
        Some("party:gamma")
    );

    // Keep the physical key held so its repeat carries the old menu generation
    // across the delayed control transition and is rejected as stale.
    let held_move = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowUp,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    assert_cursor_intent(
        std::slice::from_ref(&held_move),
        ids.guest,
        initial_generation,
        safe(1),
    );
    trace.push(held_move.clone());
    assert_replacement_menu(
        &held_move.snapshot,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Guest,
            owner: ids.guest,
            generation: initial_generation,
            operation_id: &ids.head_operation,
            control_id: &ids.head_control_id,
            field_index: safe(0),
            cursor: safe(1),
            option_id: &ids.head_choice,
        },
    )?;
    assert_eq!(
        selected_option(&held_move.snapshot, PairEndpoint::Guest).as_deref(),
        Some("party:beta")
    );

    let expected_repeat_owner = TimerOwner::input_repeat(GameButton::Up);
    let held_repeat_timer = held_move
        .generated_effects
        .iter()
        .find_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                endpoint,
                timer_id,
                owner,
                delay_ms,
                time_class: TimeClass::HumanInput,
            } if *endpoint == ids.guest
                && owner == &expected_repeat_owner
                && *delay_ms == safe(250) =>
            {
                Some(*timer_id)
            }
            _ => None,
        })
        .ok_or_else(|| {
            std::io::Error::other("held directional input did not schedule a 250ms repeat timer")
        })?;
    assert!(
        held_move
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&held_repeat_timer),
        "held directional input did not retain its scheduled repeat timer"
    );

    let before_head_submit = pair.snapshot()?;
    assert_eq!(before_head_submit.guest.ui.generation, initial_generation);
    assert_eq!(before_head_submit.guest.ui.owner_seat, Some(ids.guest));
    assert!(before_head_submit.guest.ui.actionable);
    assert_replacement_menu(
        &before_head_submit,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Guest,
            owner: ids.guest,
            generation: initial_generation,
            operation_id: &ids.head_operation,
            control_id: &ids.head_control_id,
            field_index: safe(0),
            cursor: safe(1),
            option_id: &ids.head_choice,
        },
    )?;
    assert!(
        before_head_submit
            .guest
            .live_resources
            .timers
            .contains(&held_repeat_timer),
        "the held repeat timer must be live before the successor control change"
    );
    let head_submit = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert_replacement_intent(
        &head_submit,
        &before_head_submit,
        &ReplacementIntentExpectation {
            menu: ReplacementMenuExpectation {
                endpoint: PairEndpoint::Guest,
                owner: ids.guest,
                generation: before_head_submit.guest.ui.generation,
                operation_id: &ids.head_operation,
                control_id: &ids.head_control_id,
                field_index: safe(0),
                cursor: safe(1),
                option_id: &ids.head_choice,
            },
            endpoint: ids.guest,
        },
    )?;
    assert_eq!(
        proposal_effects(&head_submit),
        vec![ProposalMessage {
            operation_id: ids.head_operation.clone(),
            fingerprint: ids.head_fingerprint.clone(),
            from: ids.guest,
            to: ids.host,
            connection_generation: generation(0),
            payload: ids.head_proposal_payload.clone(),
        }],
        "head replacement emitted an incomplete or non-canonical proposal identity"
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
    assert_ne!(
        tail_ready.guest.ui.generation, before_head_submit.guest.ui.generation,
        "successor menu must advance its generation"
    );
    assert_ne!(
        tail_ready.guest.ui.owner_seat, before_head_submit.guest.ui.owner_seat,
        "successor menu must change its owner"
    );
    assert!(
        tail_ready
            .guest
            .live_resources
            .timers
            .contains(&held_repeat_timer),
        "the held repeat timer must remain live until the stale 250ms fire"
    );
    assert_eq!(
        selected_option(&tail_ready, PairEndpoint::Host).as_deref(),
        Some("party:alpha")
    );
    assert_replacement_menu(
        &tail_ready,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Host,
            owner: ids.host,
            generation: tail_ready.host.ui.generation,
            operation_id: &ids.tail_operation,
            control_id: &ids.tail_control_id,
            field_index: safe(0),
            cursor: safe(0),
            option_id: &ids.tail_choice,
        },
    )?;
    assert_replacement_menu(
        &tail_ready,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Guest,
            owner: ids.host,
            generation: tail_ready.guest.ui.generation,
            operation_id: &ids.tail_operation,
            control_id: &ids.tail_control_id,
            field_index: safe(0),
            cursor: safe(0),
            option_id: &ids.tail_choice,
        },
    )?;

    let before_stale = pair.snapshot()?;
    let stale_repeat = pair.apply(PairOperation::AdvanceTime {
        delta_ms: safe(250),
    })?;
    trace.push(stale_repeat.clone());
    assert_eq!(
        stale_repeat.operation,
        PairOperation::AdvanceTime {
            delta_ms: safe(250),
        }
    );
    assert_eq!(
        stale_repeat.snapshot.virtual_time_ms.get(),
        before_stale.virtual_time_ms.get() + 250
    );
    assert_replacement_menu(
        &stale_repeat.snapshot,
        &ReplacementMenuExpectation {
            endpoint: PairEndpoint::Guest,
            owner: ids.host,
            generation: tail_ready.guest.ui.generation,
            operation_id: &ids.tail_operation,
            control_id: &ids.tail_control_id,
            field_index: safe(0),
            cursor: safe(0),
            option_id: &ids.tail_choice,
        },
    )?;
    assert!(
        !stale_repeat
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&held_repeat_timer),
        "stale repeat processing must consume the old held-input timer"
    );
    assert_no_ui_intent(
        std::slice::from_ref(&stale_repeat),
        ids.guest,
        "a repeat from the pre-control menu must not create a UI intent",
    );
    assert_no_replacement_submission(
        std::slice::from_ref(&stale_repeat),
        ids.guest,
        "a stale repeat must not create a replacement submission",
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

    let before_tail_submit = pair.snapshot()?;
    let tail_submit = pair.press(PairEndpoint::Host, PhysicalKey::Enter)?;
    assert_replacement_intent(
        &tail_submit,
        &before_tail_submit,
        &ReplacementIntentExpectation {
            menu: ReplacementMenuExpectation {
                endpoint: PairEndpoint::Host,
                owner: ids.host,
                generation: before_tail_submit.host.ui.generation,
                operation_id: &ids.tail_operation,
                control_id: &ids.tail_control_id,
                field_index: safe(0),
                cursor: safe(0),
                option_id: &ids.tail_choice,
            },
            endpoint: ids.host,
        },
    )?;
    assert!(
        proposal_effects(&tail_submit).is_empty(),
        "authority-local replacement must not emit a self-signed proposal"
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

    let authority_context = context(ids.host)?;
    let replica_context = context(ids.guest)?;
    assert_authority_chain(
        &trace,
        &AuthorityChainExpectation {
            operation_id: &ids.head_operation,
            revision_value: 1,
            material: &ids.head_material,
            next_control: &ids.head_next_control,
            expected_control_id: &ids.tail_control_id,
            context: AuthorityChainContext {
                authority_context: &authority_context,
                replica_context: &replica_context,
                authority_seat: ids.host,
                replica_seat: ids.guest,
            },
            prior_frontier: (0, 0, 0),
        },
    )?;
    assert_authority_chain(
        &trace,
        &AuthorityChainExpectation {
            operation_id: &ids.tail_operation,
            revision_value: 2,
            material: &ids.tail_material,
            next_control: &ids.tail_next_control,
            expected_control_id: &ids.await_control_id,
            context: AuthorityChainContext {
                authority_context: &authority_context,
                replica_context: &replica_context,
                authority_seat: ids.host,
                replica_seat: ids.guest,
            },
            prior_frontier: (1, 1, 1),
        },
    )?;

    let final_snapshot = pair.teardown("replacement campaign complete")?;
    assert_zero_resources(&final_snapshot);
    assert_post_disposal_rejected(&mut pair)?;

    Ok(CampaignRun {
        trace,
        final_snapshot,
    })
}

#[test]
fn delayed_asymmetric_replacement_campaign_is_raw_and_deterministically_convergent() -> TestResult {
    let first = run_campaign(0x5eed_cafe)?;
    for execution in 1..DETERMINISTIC_EXECUTIONS {
        let repeated = run_campaign(0x5eed_cafe)?;
        assert_eq!(
            repeated.trace, first.trace,
            "deterministic execution {execution} diverged"
        );
        assert_eq!(
            repeated.final_snapshot, first.final_snapshot,
            "deterministic final snapshot {execution} diverged"
        );
    }
    Ok(())
}
