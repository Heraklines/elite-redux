use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, KernelEffect, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AckStage, AuthorityEntryBody, AuthorityEntryDraft, AuthorityLogConfig, AuthorityReceiptBody,
    AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalFingerprintInput, ProposalJson,
    ProposalLeaseConfig, RecoveryTransactionConfig, control_id_of, proposal_fingerprint,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig,
};
use er_types::{
    AuthorityEntryKind, AwaitSuccessorControl, CancelPolicy, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, FRAME_PROTOCOL_VERSION, FrameContext, FrameType,
    GameButton, InputMap, KeyBinding, Material, MembershipRevision, MenuGeneration, MenuOption,
    MenuOptionId, MenuState, NextControl, OperationId, PhysicalKey, PresentationEventId,
    ProposalMessage, Revision, RunId, SafeI53, SafeU53, SeatId, SessionId, TimeClass, TimerId,
    TimerOwner, UiIntent, UiState, UiViewKind,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const GUEST_OPERATION: &str = "turn/guest";
const HOST_OPERATION: &str = "turn/host";
const GUEST_OPTION_A: &str = "command:guest:a";
const GUEST_OPTION_B: &str = "command:guest:b";
const HOST_OPTION: &str = "command:host";

const GUEST_A_WIRE: &str = r#"{"choice":"a"}"#;
const GUEST_B_WIRE: &str = r#"{"choice":"b"}"#;
const HOST_WIRE: &str = r#"{"choice":"host"}"#;
const GUEST_A_REWARD: &str = r#"{"surface":"guest-command","slot":0}"#;
const GUEST_B_REWARD: &str = r#"{"surface":"guest-command","slot":1}"#;
const HOST_REWARD: &str = r#"{"surface":"host-command","slot":1}"#;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("campaign value must fit SafeU53")
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("campaign operation must be non-empty")
}

fn ordinary_fingerprint(
    sequence: u64,
    label: &str,
    choice: i64,
    wire: &str,
    reward_surface: &str,
) -> String {
    proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(sequence),
        label: label.to_owned(),
        choice: SafeI53::new(choice).expect("campaign choice must fit SafeI53"),
        wire: Some(ProposalJson::new(wire).expect("campaign wire must be valid JSON")),
        reward_surface: Some(
            ProposalJson::new(reward_surface).expect("campaign reward surface must be valid JSON"),
        ),
    })
    .expect("campaign proposal fingerprint must be valid")
}

fn guest_a_fingerprint() -> String {
    ordinary_fingerprint(1, "turnCommand", 0, GUEST_A_WIRE, GUEST_A_REWARD)
}

fn guest_b_fingerprint() -> String {
    ordinary_fingerprint(1, "turnCommand", 1, GUEST_B_WIRE, GUEST_B_REWARD)
}

fn host_fingerprint() -> String {
    ordinary_fingerprint(2, "turnCommand", 0, HOST_WIRE, HOST_REWARD)
}

fn proposal_payload(choice: &str) -> Value {
    json!({"choice": choice})
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
            material: authority_material(field_index, choice),
            next_control,
            subsumes: Vec::new(),
        },
    }
}

fn authority_material(field_index: u64, choice: &str) -> Material {
    Material {
        digest: format!("digest:{choice}"),
        payload: json!({
            "epoch": 1,
            "wave": 1,
            "turn": 1,
            "fieldIndex": field_index,
            "choice": choice,
        }),
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
    let guest_a_fingerprint_value = guest_a_fingerprint();
    let guest_b_fingerprint_value = guest_b_fingerprint();
    let host_fingerprint_value = host_fingerprint();
    let guest_proposals = vec![
        MenuProposalPlan {
            option_id: guest_options[0].id.clone(),
            fingerprint: guest_a_fingerprint_value.clone(),
            payload: proposal_payload("a"),
        },
        MenuProposalPlan {
            option_id: guest_options[1].id.clone(),
            fingerprint: guest_b_fingerprint_value.clone(),
            payload: proposal_payload("b"),
        },
    ];
    let host_proposals = vec![MenuProposalPlan {
        option_id: host_options[0].id.clone(),
        fingerprint: host_fingerprint_value.clone(),
        payload: proposal_payload("host"),
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
            &guest_a_fingerprint_value,
            0,
            "a",
            remaining.clone(),
        ),
        authority_resolution(
            guest_operation,
            &guest_b_fingerprint_value,
            0,
            "b",
            remaining,
        ),
        authority_resolution(
            host_operation,
            &host_fingerprint_value,
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

fn command_intents(step: &PairStep, endpoint: SeatId) -> Vec<UiIntent> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent: intent @ UiIntent::CommandSubmitted { .. },
            } if *effect_endpoint == endpoint => Some(intent.clone()),
            _ => None,
        })
        .collect()
}

fn cursor_intents(step: &PairStep, endpoint: SeatId) -> Vec<UiIntent> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent: intent @ UiIntent::CursorChanged { .. },
            } if *effect_endpoint == endpoint => Some(intent.clone()),
            _ => None,
        })
        .collect()
}

fn assert_command_intent(
    step: &PairStep,
    endpoint: SeatId,
    generation: MenuGeneration,
    operation_id: &str,
    control_id: &str,
    option_id: &str,
) {
    assert_eq!(
        command_intents(step, endpoint),
        vec![UiIntent::CommandSubmitted {
            seat: endpoint,
            generation,
            operation_id: operation(operation_id),
            control_id: control_id.to_owned(),
            option_id: MenuOptionId::new(option_id).expect("campaign option must be non-empty"),
        }]
    );
}

fn assert_cursor_intent(
    step: &PairStep,
    endpoint: SeatId,
    generation: MenuGeneration,
    cursor: SafeU53,
) {
    assert_eq!(
        cursor_intents(step, endpoint),
        vec![UiIntent::CursorChanged {
            seat: endpoint,
            generation,
            cursor,
        }]
    );
}

fn assert_no_command_or_cursor_intent(step: &PairStep, endpoint: SeatId) {
    assert!(step.generated_effects.iter().all(|effect| {
        !matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint: effect_endpoint,
                intent: UiIntent::CommandSubmitted { .. } | UiIntent::CursorChanged { .. },
            } if *effect_endpoint == endpoint
        )
    }));
}

fn assert_proposal_effect(
    step: &PairStep,
    operation_id: &str,
    fingerprint: String,
    from: SeatId,
    to: SeatId,
    payload: Value,
) {
    let proposals = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect::<Vec<ProposalMessage>>();
    assert_eq!(
        proposals,
        vec![ProposalMessage {
            operation_id: operation(operation_id),
            fingerprint,
            from,
            to,
            connection_generation: ConnectionGeneration::ZERO,
            payload,
        }]
    );
}

fn assert_authority_local_submission(
    step: &PairStep,
    endpoint: SeatId,
    revision: u64,
    operation_id: &str,
    material: &Material,
    control: &NextControl,
) -> TestResult {
    let proposals = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect::<Vec<ProposalMessage>>();
    assert!(proposals.is_empty());

    assert_material_effect(step, endpoint, revision, operation_id, material);
    assert_control_effect(step, endpoint, revision, operation_id, control);
    let authority_effect_order = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint: effect_endpoint,
                ..
            } if *effect_endpoint == endpoint => Some("material"),
            KernelEffect::ProjectAuthorityControl {
                endpoint: effect_endpoint,
                ..
            } if *effect_endpoint == endpoint => Some("control"),
            KernelEffect::SendFrame { from, frame }
                if *from == endpoint && frame.frame_type == FrameType::AuthorityEntry =>
            {
                Some("authorityEntry")
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        authority_effect_order,
        vec!["material", "authorityEntry", "control"]
    );

    let mut entries = Vec::new();
    for effect in &step.generated_effects {
        if let KernelEffect::SendFrame { from, frame } = effect
            && frame.frame_type == FrameType::AuthorityEntry
        {
            entries.push((
                *from,
                frame.version,
                frame.context.clone(),
                serde_json::from_value::<AuthorityEntryBody>(frame.body.clone())?,
            ));
        }
    }
    assert_eq!(
        entries,
        vec![(
            endpoint,
            FRAME_PROTOCOL_VERSION,
            context(0),
            AuthorityEntryBody {
                revision: Revision::new(safe(revision)),
                operation_id: operation(operation_id),
                kind: AuthorityEntryKind::TurnCommit,
                material: material.clone(),
                next_control: control.clone(),
                subsumes: Vec::new(),
            },
        )]
    );
    Ok(())
}

fn assert_repeat_timer(
    step: &PairStep,
    endpoint: SeatId,
    button: GameButton,
) -> TestResult<TimerId> {
    let timers = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                endpoint: effect_endpoint,
                timer_id,
                owner,
                delay_ms,
                time_class,
            } if *effect_endpoint == endpoint => Some((*timer_id, owner, *delay_ms, *time_class)),
            _ => None,
        })
        .collect::<Vec<_>>();
    let [timer] = timers.as_slice() else {
        return Err(format!(
            "expected exactly one repeat timer for {button:?}, got {}",
            timers.len()
        )
        .into());
    };
    let (timer_id, owner, delay_ms, time_class) = *timer;
    assert_eq!(owner, &TimerOwner::input_repeat(button));
    assert_eq!(delay_ms, safe(250));
    assert_eq!(time_class, TimeClass::HumanInput);
    Ok(timer_id)
}

fn proposal_retry_owner() -> TimerOwner {
    TimerOwner {
        owner_id: format!("m2b-04:proposal:{GUEST_OPERATION}"),
        address: GUEST_OPERATION.to_owned(),
        reason: "v2 proposal retry".to_owned(),
    }
}

fn assert_proposal_retry_timer(snapshot: &PairSnapshot) -> TimerId {
    let timers = snapshot
        .clock_timers
        .iter()
        .filter(|timer| {
            timer.timer.endpoint == seat(1)
                && timer.timer.owner == proposal_retry_owner()
                && timer.timer.time_class == TimeClass::Connected
        })
        .collect::<Vec<_>>();
    assert_eq!(
        timers.len(),
        1,
        "expected one retained proposal retry timer"
    );
    let Some(timer) = timers.first() else {
        unreachable!("the retained proposal retry timer disappeared");
    };
    assert_eq!(timer.timer.delay_ms, safe(500));
    assert_eq!(timer.remaining_active_ms, safe(500));
    assert!(!timer.paused);
    timer.timer.timer_id
}

fn assert_no_input_repeat_timer(snapshot: &PairSnapshot, endpoint: SeatId, button: GameButton) {
    let owner = TimerOwner::input_repeat(button);
    assert!(
        snapshot
            .clock_timers
            .iter()
            .all(|timer| { !(timer.timer.endpoint == endpoint && timer.timer.owner == owner) })
    );
}

fn assert_no_input_repeat_schedule(step: &PairStep, endpoint: SeatId, button: GameButton) {
    let owner = TimerOwner::input_repeat(button);
    assert!(!step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ScheduleTimer {
                endpoint: effect_endpoint,
                owner: effect_owner,
                ..
            } if *effect_endpoint == endpoint && effect_owner == &owner
        )
    }));
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

fn assert_material_effect(
    step: &PairStep,
    endpoint: SeatId,
    revision: u64,
    operation_id: &str,
    material: &Material,
) {
    let effects = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint: effect_endpoint,
                revision: effect_revision,
                operation_id: effect_operation,
                material: effect_material,
            } if *effect_endpoint == endpoint => {
                Some((*effect_revision, effect_operation, effect_material))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        effects.len(),
        1,
        "expected one material effect for {operation_id}"
    );
    let Some((effect_revision, effect_operation, effect_material)) = effects.first().copied()
    else {
        unreachable!("the material effect disappeared");
    };
    assert_eq!(effect_revision, Revision::new(safe(revision)));
    assert_eq!(effect_operation.as_str(), operation_id);
    assert_eq!(effect_material, material);
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

fn material_effect_count(steps: &[PairStep], endpoint: SeatId, operation_id: &str) -> usize {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::ApplyAuthorityMaterial {
                    endpoint: effect_endpoint,
                    operation_id: effect_operation,
                    ..
                } if *effect_endpoint == endpoint && effect_operation.as_str() == operation_id
            )
        })
        .count()
}

fn control_effect_count(steps: &[PairStep], endpoint: SeatId, operation_id: &str) -> usize {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::ProjectAuthorityControl {
                    endpoint: effect_endpoint,
                    operation_id: effect_operation,
                    ..
                } if *effect_endpoint == endpoint && effect_operation.as_str() == operation_id
            )
        })
        .count()
}

fn presentation_effect_count(steps: &[PairStep], endpoint: SeatId, revision: u64) -> usize {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::Present {
                    endpoint: effect_endpoint,
                    event,
                } if *effect_endpoint == endpoint
                    && event.event_id == PresentationEventId::new(safe(revision))
            )
        })
        .count()
}

fn assert_control_effect(
    step: &PairStep,
    endpoint: SeatId,
    revision: u64,
    operation_id: &str,
    control: &NextControl,
) {
    let effects = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ProjectAuthorityControl {
                endpoint: effect_endpoint,
                revision: effect_revision,
                operation_id: effect_operation,
                control: effect_control,
            } if *effect_endpoint == endpoint => {
                Some((*effect_revision, effect_operation, effect_control))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        effects.len(),
        1,
        "expected one control effect for {operation_id}"
    );
    let Some((effect_revision, effect_operation, effect_control)) = effects.first().copied() else {
        unreachable!("the control effect disappeared");
    };
    assert_eq!(effect_revision, Revision::new(safe(revision)));
    assert_eq!(effect_operation.as_str(), operation_id);
    assert_eq!(effect_control, control);
    assert_eq!(control_id_of(effect_control), control_id_of(control));
}

fn authority_receipts(step: &PairStep) -> Vec<(SeatId, FrameContext, AuthorityReceiptBody)> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { from, frame }
                if frame.frame_type == FrameType::AuthorityReceipt =>
            {
                let body = serde_json::from_value::<AuthorityReceiptBody>(frame.body.clone())
                    .expect("authorityReceipt body must match the typed protocol body");
                Some((*from, frame.context.clone(), body))
            }
            _ => None,
        })
        .collect()
}

fn authority_receipts_for(
    step: &PairStep,
    revision: u64,
    operation_id: &str,
) -> Vec<(SeatId, FrameContext, AuthorityReceiptBody)> {
    let revision = Revision::new(safe(revision));
    let operation_id = operation(operation_id);
    authority_receipts(step)
        .into_iter()
        .filter(|(_, _, body)| body.revision == revision && body.operation_id == operation_id)
        .collect()
}

fn expected_receipt(
    revision: u64,
    operation_id: &str,
    stage: AckStage,
    control_id: Option<&str>,
) -> (SeatId, FrameContext, AuthorityReceiptBody) {
    (
        seat(1),
        context(1),
        AuthorityReceiptBody {
            revision: Revision::new(safe(revision)),
            operation_id: operation(operation_id),
            stage,
            control_id: control_id.map(str::to_owned),
        },
    )
}

fn expected_progress_receipts(
    revision: u64,
    operation_id: &str,
    control_id: &str,
    replay_control_id: Option<&str>,
) -> Vec<(SeatId, FrameContext, AuthorityReceiptBody)> {
    let mut expected = vec![
        expected_receipt(revision, operation_id, AckStage::Admitted, None),
        expected_receipt(revision, operation_id, AckStage::MaterialApplied, None),
        expected_receipt(
            revision,
            operation_id,
            AckStage::ControlInstalled,
            Some(control_id),
        ),
        expected_receipt(revision, operation_id, AckStage::PresentationSettled, None),
    ];
    if let Some(replay_control_id) = replay_control_id {
        expected.push(expected_receipt(
            revision,
            operation_id,
            AckStage::ControlInstalled,
            Some(replay_control_id),
        ));
        expected.push(expected_receipt(
            revision,
            operation_id,
            AckStage::PresentationSettled,
            None,
        ));
    }
    expected
}

fn assert_exact_receipts(step: &PairStep, revision: u64, operation_id: &str, control_id: &str) {
    assert_eq!(
        authority_receipts(step),
        expected_progress_receipts(revision, operation_id, control_id, None)
    );
}

fn assert_exact_entry_receipts(
    step: &PairStep,
    revision: u64,
    operation_id: &str,
    control_id: &str,
    replay_control_id: Option<&str>,
) {
    assert_eq!(
        authority_receipts_for(step, revision, operation_id),
        expected_progress_receipts(revision, operation_id, control_id, replay_control_id)
    );
}

fn authority_entry_revisions(step: &PairStep) -> Vec<Revision> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { frame, .. }
                if frame.frame_type == FrameType::AuthorityEntry =>
            {
                Some(
                    serde_json::from_value::<AuthorityEntryBody>(frame.body.clone())
                        .expect("authorityEntry body must match the typed protocol body")
                        .revision,
                )
            }
            _ => None,
        })
        .collect()
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

fn replica_frontier(step: &PairStep) -> Option<(u64, u64, u64)> {
    find_frontier(&step.snapshot.guest.kernel.state)
}

fn replica_frontier_from_snapshot(snapshot: &PairSnapshot) -> Option<(u64, u64, u64)> {
    find_frontier(&snapshot.guest.kernel.state)
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
    assert_eq!(replica_frontier_from_snapshot(&initial), Some((0, 0, 0)));

    let wrong_seat = pair.key_down(PairEndpoint::Host, PhysicalKey::Enter, false)?;
    assert_eq!(wrong_seat.snapshot.host.ui, initial.host.ui);
    assert!(wrong_seat.snapshot.network.queued_packet_ids.is_empty());
    assert_no_command_or_cursor_intent(&wrong_seat, seat(0));
    steps.push(wrong_seat);
    steps.push(pair.key_up(PairEndpoint::Host, PhysicalKey::Enter)?);

    let moved = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?;
    assert_eq!(moved.snapshot.guest.ui.cursor, Some(safe(1)));
    assert_cursor_intent(&moved, seat(1), MenuGeneration::new(safe(1)), safe(1));
    steps.push(moved);
    steps.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?);

    let guest_submitted = pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false)?;
    assert_command_intent(
        &guest_submitted,
        seat(1),
        MenuGeneration::new(safe(1)),
        GUEST_OPERATION,
        &control_id_of(&initial_control()),
        GUEST_OPTION_B,
    );
    assert_proposal_effect(
        &guest_submitted,
        GUEST_OPERATION,
        guest_b_fingerprint(),
        seat(1),
        seat(0),
        proposal_payload("b"),
    );
    steps.push(guest_submitted);
    steps.push(pair.key_up(PairEndpoint::Guest, PhysicalKey::Enter)?);

    let after_guest_proposal = pair.snapshot()?;
    assert_eq!(after_guest_proposal.network.queued_packet_ids.len(), 1);
    assert_eq!(
        replica_frontier_from_snapshot(&after_guest_proposal),
        Some((0, 0, 0))
    );
    steps.push(pair.apply(PairOperation::Fault {
        operation: FaultOperation::DeliverNext,
    })?);

    let after_first_commit = pair.snapshot()?;
    assert_eq!(after_first_commit.host.ui.kind, UiViewKind::Command);
    assert_eq!(after_first_commit.host.ui.owner_seat, Some(seat(0)));
    assert!(after_first_commit.host.ui.actionable);
    assert_eq!(
        after_first_commit.host.ui.generation,
        MenuGeneration::new(safe(2))
    );

    let host_submitted = pair.key_down(PairEndpoint::Host, PhysicalKey::Enter, false)?;
    assert_command_intent(
        &host_submitted,
        seat(0),
        MenuGeneration::new(safe(2)),
        HOST_OPERATION,
        &control_id_of(&remaining_control()),
        HOST_OPTION,
    );
    assert_authority_local_submission(
        &host_submitted,
        seat(0),
        2,
        HOST_OPERATION,
        &authority_material(1, "host"),
        &await_control(),
    )?;
    steps.push(host_submitted);
    steps.push(pair.key_up(PairEndpoint::Host, PhysicalKey::Enter)?);

    let queued_entries = pair
        .snapshot()?
        .network
        .queued_packet_ids
        .into_iter()
        .collect::<Vec<_>>();
    let [first_entry_packet, second_entry_packet] = queued_entries.as_slice() else {
        return Err("expected exactly two queued authority entries".into());
    };
    let first_entry_packet = *first_entry_packet;
    let second_entry_packet = *second_entry_packet;

    let before_n_plus_one = pair.snapshot()?;
    assert_eq!(
        replica_frontier_from_snapshot(&before_n_plus_one),
        Some((0, 0, 0))
    );
    assert!(
        before_n_plus_one
            .network
            .queued_packet_ids
            .contains(&second_entry_packet)
    );
    assert!(
        before_n_plus_one
            .host
            .live_resources
            .retained_revisions
            .contains(&Revision::new(safe(2)))
    );
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
    assert_eq!(replica_frontier(&blocked), Some((0, 0, 0)));
    assert!(
        blocked
            .snapshot
            .network
            .queued_packet_ids
            .contains(&first_entry_packet)
    );
    assert!(
        !blocked
            .snapshot
            .network
            .queued_packet_ids
            .contains(&second_entry_packet)
    );
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
    assert!(
        blocked
            .snapshot
            .host
            .live_resources
            .retained_revisions
            .contains(&Revision::new(safe(2)))
    );
    assert!(!has_material_effect(&blocked, HOST_OPERATION));
    assert!(!has_control_effect(&blocked, HOST_OPERATION));
    let Some(tail_request_packet) = tail_request_packets.first().copied() else {
        return Err("missing tail request packet".into());
    };
    steps.push(blocked);

    let stale_input = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowUp, false)?;
    assert_cursor_intent(&stale_input, seat(1), MenuGeneration::new(safe(1)), safe(0));
    let repeat_timer_id = assert_repeat_timer(&stale_input, seat(1), GameButton::Up)?;
    assert!(
        stale_input
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&repeat_timer_id)
    );
    steps.push(stale_input);

    let first_entry = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: first_entry_packet,
        },
    })?;
    assert_ne!(
        first_entry.snapshot.guest.ui.generation,
        before_n_plus_one.guest.ui.generation
    );
    assert_eq!(first_entry.snapshot.guest.ui.kind, UiViewKind::None);
    assert_eq!(first_entry.snapshot.guest.ui.owner_seat, None);
    assert!(!first_entry.snapshot.guest.ui.actionable);
    assert_eq!(
        first_entry.snapshot.guest.ui.generation,
        MenuGeneration::new(safe(2))
    );
    assert_eq!(first_entry.snapshot.guest.ui.cursor, None);
    assert!(first_entry.snapshot.guest.ui.options.is_empty());
    assert_eq!(first_entry.snapshot.guest.ui.prompt_key, None);
    assert_eq!(
        first_entry.snapshot.guest.kernel.ui.stack,
        vec![MenuState::None]
    );
    assert_eq!(replica_frontier(&first_entry), Some((1, 1, 1)));
    assert_material_effect(
        &first_entry,
        seat(1),
        1,
        GUEST_OPERATION,
        &authority_material(0, "b"),
    );
    assert_control_effect(
        &first_entry,
        seat(1),
        1,
        GUEST_OPERATION,
        &remaining_control(),
    );
    assert_exact_receipts(
        &first_entry,
        1,
        GUEST_OPERATION,
        &control_id_of(&remaining_control()),
    );
    steps.push(first_entry);

    let before_stale_repeat_packets = pair.snapshot()?.network.queued_packet_ids;
    assert!(before_stale_repeat_packets.contains(&tail_request_packet));
    let stale_repeat = pair.advance_time(safe(250))?;
    assert_eq!(stale_repeat.snapshot.host.ui.kind, UiViewKind::Waiting);
    assert_eq!(
        stale_repeat.snapshot.host.ui.generation,
        MenuGeneration::new(safe(3))
    );
    assert_eq!(stale_repeat.snapshot.host.ui.owner_seat, None);
    assert!(!stale_repeat.snapshot.host.ui.actionable);
    assert_eq!(
        stale_repeat.snapshot.host.ui.prompt_key.as_deref(),
        Some("await/turn/host")
    );
    assert!(matches!(
        stale_repeat.snapshot.host.kernel.ui.stack.as_slice(),
        [MenuState::Waiting(menu)]
            if menu.prompt_key.as_deref() == Some("await/turn/host")
    ));
    assert_eq!(stale_repeat.snapshot.guest.ui.kind, UiViewKind::Waiting);
    assert_eq!(stale_repeat.snapshot.guest.ui.owner_seat, None);
    assert!(!stale_repeat.snapshot.guest.ui.actionable);
    assert_eq!(
        stale_repeat.snapshot.guest.ui.generation,
        MenuGeneration::new(safe(3))
    );
    assert_eq!(stale_repeat.snapshot.guest.ui.cursor, None);
    assert!(stale_repeat.snapshot.guest.ui.options.is_empty());
    assert_eq!(
        stale_repeat.snapshot.guest.ui.prompt_key.as_deref(),
        Some("await/turn/host")
    );
    assert!(matches!(
        stale_repeat.snapshot.guest.kernel.ui.stack.as_slice(),
        [MenuState::Waiting(menu)]
            if menu.prompt_key.as_deref() == Some("await/turn/host")
    ));
    assert_eq!(replica_frontier(&stale_repeat), Some((2, 2, 2)));
    assert_material_effect(
        &stale_repeat,
        seat(1),
        2,
        HOST_OPERATION,
        &authority_material(1, "host"),
    );
    assert_control_effect(&stale_repeat, seat(1), 2, HOST_OPERATION, &await_control());
    assert_exact_entry_receipts(
        &stale_repeat,
        2,
        HOST_OPERATION,
        &control_id_of(&await_control()),
        Some(&control_id_of(&await_control())),
    );
    let duplicate_receipts = authority_receipts_for(&stale_repeat, 1, GUEST_OPERATION);
    assert_eq!(
        duplicate_receipts,
        vec![
            expected_receipt(
                1,
                GUEST_OPERATION,
                AckStage::ControlInstalled,
                Some(&control_id_of(&remaining_control())),
            ),
            expected_receipt(1, GUEST_OPERATION, AckStage::PresentationSettled, None),
        ]
    );
    let revision_two_receipts = authority_receipts_for(&stale_repeat, 2, HOST_OPERATION);
    assert_eq!(
        authority_receipts(&stale_repeat).len(),
        duplicate_receipts.len() + revision_two_receipts.len()
    );
    assert!(!has_material_effect(&stale_repeat, GUEST_OPERATION));
    assert!(!has_control_effect(&stale_repeat, GUEST_OPERATION));
    assert_eq!(
        presentation_effect_count(std::slice::from_ref(&stale_repeat), seat(1), 2),
        1,
        "the stale-repeat step must present exactly the new revision"
    );
    assert_eq!(
        presentation_effect_count(std::slice::from_ref(&stale_repeat), seat(1), 1),
        0,
        "the stale-repeat step must not re-present the completed revision"
    );
    assert!(
        stale_repeat
            .snapshot
            .guest
            .live_resources
            .presentations
            .is_empty()
    );
    let replay_revisions = authority_entry_revisions(&stale_repeat);
    assert_eq!(
        replay_revisions,
        vec![
            Revision::new(safe(1)),
            Revision::new(safe(2)),
            Revision::new(safe(2)),
        ]
    );
    assert_no_command_or_cursor_intent(&stale_repeat, seat(1));
    assert_proposal_effect(
        &stale_repeat,
        GUEST_OPERATION,
        guest_b_fingerprint(),
        seat(1),
        seat(0),
        proposal_payload("b"),
    );
    // The control projection has made this logical repeat stale. Its input
    // timer is consumed without a rearm; the retained TurnCommit proposal
    // lease is a separate protocol resource and remains live.
    assert_no_input_repeat_schedule(&stale_repeat, seat(1), GameButton::Up);
    assert!(
        !stale_repeat
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&repeat_timer_id)
    );
    assert_no_input_repeat_timer(&stale_repeat.snapshot, seat(1), GameButton::Up);
    let scheduled_guest_timers = stale_repeat
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                endpoint,
                timer_id,
                owner,
                delay_ms,
                time_class,
            } if *endpoint == seat(1) => Some((*timer_id, owner, *delay_ms, *time_class)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(scheduled_guest_timers.len(), 1);
    let Some((scheduled_timer_id, scheduled_owner, scheduled_delay_ms, scheduled_time_class)) =
        scheduled_guest_timers.first().copied()
    else {
        return Err("the proposal retry schedule disappeared".into());
    };
    assert_eq!(scheduled_owner, &proposal_retry_owner());
    assert_eq!(scheduled_delay_ms, safe(500));
    assert_eq!(scheduled_time_class, TimeClass::Connected);
    let proposal_retry_timer_id = assert_proposal_retry_timer(&stale_repeat.snapshot);
    assert_eq!(scheduled_timer_id, proposal_retry_timer_id);
    assert!(
        stale_repeat
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&proposal_retry_timer_id)
    );
    assert_eq!(
        stale_repeat
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .len(),
        1
    );
    assert!(
        stale_repeat
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&operation(GUEST_OPERATION))
    );
    let retry_packet_ids = stale_repeat
        .snapshot
        .network
        .queued_packet_ids
        .difference(&before_stale_repeat_packets)
        .copied()
        .collect::<Vec<_>>();
    let Some(retry_packet_id) = retry_packet_ids.first().copied() else {
        return Err("missing proposal retry packet".into());
    };
    assert_eq!(retry_packet_ids.len(), 1);
    let expected_retry_packet_set = retry_packet_ids.iter().copied().collect::<BTreeSet<_>>();
    assert_eq!(
        stale_repeat.snapshot.network.queued_packet_ids,
        expected_retry_packet_set
    );
    assert!(
        !stale_repeat
            .snapshot
            .network
            .queued_packet_ids
            .contains(&tail_request_packet)
    );
    steps.push(stale_repeat);
    let stale_release = pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowUp)?;
    assert_eq!(replica_frontier(&stale_release), Some((2, 2, 2)));
    assert_no_command_or_cursor_intent(&stale_release, seat(1));
    assert!(!has_material_effect(&stale_release, GUEST_OPERATION));
    assert!(!has_material_effect(&stale_release, HOST_OPERATION));
    assert!(!has_control_effect(&stale_release, GUEST_OPERATION));
    assert!(!has_control_effect(&stale_release, HOST_OPERATION));
    assert!(authority_receipts(&stale_release).is_empty());
    assert!(authority_entry_revisions(&stale_release).is_empty());
    let cancelled_timers = stale_release
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::CancelTimer { endpoint, timer_id } => Some((*endpoint, *timer_id)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(cancelled_timers.is_empty());
    assert!(
        !stale_release
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&repeat_timer_id)
    );
    assert_no_input_repeat_timer(&stale_release.snapshot, seat(1), GameButton::Up);
    assert_eq!(
        assert_proposal_retry_timer(&stale_release.snapshot),
        proposal_retry_timer_id
    );
    assert!(
        stale_release
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&proposal_retry_timer_id)
    );
    assert_eq!(
        stale_release
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .len(),
        1
    );
    assert!(
        stale_release
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&operation(GUEST_OPERATION))
    );
    assert_eq!(
        stale_release.snapshot.network.queued_packet_ids,
        expected_retry_packet_set
    );
    steps.push(stale_release);

    let before_teardown = pair.snapshot()?;
    assert_eq!(
        replica_frontier_from_snapshot(&before_teardown),
        Some((2, 2, 2))
    );
    assert_eq!(before_teardown.guest.ui.kind, UiViewKind::Waiting);
    assert!(!before_teardown.guest.ui.actionable);
    assert_eq!(
        before_teardown.network.queued_packet_ids,
        expected_retry_packet_set
    );
    assert!(
        before_teardown
            .host
            .live_resources
            .delivery_leases
            .is_empty()
    );
    // TurnCommit is settled only by explicit teardown in this campaign;
    // KeyUp must not cancel its unrelated proposal retry lease.
    assert_eq!(
        assert_proposal_retry_timer(&before_teardown),
        proposal_retry_timer_id
    );
    assert_no_input_repeat_timer(&before_teardown, seat(1), GameButton::Up);
    assert!(
        before_teardown
            .guest
            .live_resources
            .timers
            .contains(&proposal_retry_timer_id)
    );
    assert_eq!(
        before_teardown.guest.live_resources.proposal_leases.len(),
        1
    );
    assert!(
        before_teardown
            .guest
            .live_resources
            .proposal_leases
            .contains(&operation(GUEST_OPERATION))
    );
    assert!(before_teardown.host.live_resources.timers.is_empty());

    let final_snapshot = pair.teardown("m2b-04 command campaign complete")?;
    assert_eq!(final_snapshot.host.live_resources, Default::default());
    assert_eq!(final_snapshot.guest.live_resources, Default::default());
    assert!(final_snapshot.clock_timers.is_empty());
    assert!(final_snapshot.network.queued_packet_ids.is_empty());
    assert!(
        !final_snapshot
            .network
            .queued_packet_ids
            .contains(&retry_packet_id)
    );
    assert!(final_snapshot.host.presenter.pending_event_ids.is_empty());
    assert!(final_snapshot.host.presenter.settled_event_ids.is_empty());
    assert!(final_snapshot.host.presenter.disposed);
    assert!(final_snapshot.guest.presenter.pending_event_ids.is_empty());
    assert!(final_snapshot.guest.presenter.settled_event_ids.is_empty());
    assert!(final_snapshot.guest.presenter.disposed);
    assert!(final_snapshot.presenter.pending_event_ids.is_empty());
    assert!(final_snapshot.presenter.settled_event_ids.is_empty());
    assert!(final_snapshot.storage.pending_request_ids.is_empty());
    assert!(final_snapshot.network.disposed);
    assert!(final_snapshot.presenter.disposed);
    assert!(final_snapshot.storage.disposed);

    Ok((steps, final_snapshot))
}

#[test]
fn raw_key_command_campaign_covers_projection_progression_and_determinism() -> TestResult {
    assert_eq!(
        guest_a_fingerprint(),
        r#"[1,"turnCommand",0,{"choice":"a"},{"surface":"guest-command","slot":0}]"#
    );
    assert_eq!(
        guest_b_fingerprint(),
        r#"[1,"turnCommand",1,{"choice":"b"},{"surface":"guest-command","slot":1}]"#
    );
    assert_eq!(
        host_fingerprint(),
        r#"[2,"turnCommand",0,{"choice":"host"},{"surface":"host-command","slot":1}]"#
    );
    let (first_steps, first_final) = run_campaign(0x4d_3242_3034)?;
    let (second_steps, second_final) = run_campaign(0x4d_3242_3034)?;

    assert_eq!(first_steps, second_steps);
    assert_eq!(first_final, second_final);
    assert!(
        first_steps
            .iter()
            .all(|step| !step.effects_digest.is_empty())
    );
    let proposals = first_steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let expected_guest_proposal = ProposalMessage {
        operation_id: operation(GUEST_OPERATION),
        fingerprint: guest_b_fingerprint(),
        from: seat(1),
        to: seat(0),
        connection_generation: ConnectionGeneration::ZERO,
        payload: proposal_payload("b"),
    };
    assert_eq!(
        proposals,
        vec![expected_guest_proposal.clone(), expected_guest_proposal]
    );
    for (revision, operation_id) in [(1, GUEST_OPERATION), (2, HOST_OPERATION)] {
        assert_eq!(
            material_effect_count(&first_steps, seat(1), operation_id),
            1,
            "guest material application for {operation_id} was not exactly once"
        );
        assert_eq!(
            control_effect_count(&first_steps, seat(1), operation_id),
            1,
            "guest control projection for {operation_id} was not exactly once"
        );
        assert_eq!(
            presentation_effect_count(&first_steps, seat(1), revision),
            1,
            "guest visual presentation for {operation_id} was not exactly once"
        );
    }
    Ok(())
}
