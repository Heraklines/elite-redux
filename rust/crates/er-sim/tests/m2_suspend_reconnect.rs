use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, MenuProposalPlan, ProtocolKernelConfig,
    ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding,
    ProposalFingerprintInput, ProposalJson, ProposalLeaseConfig, RecoveryTransactionConfig,
    control_id_of, proposal_fingerprint,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig, SimulatedPairError,
};
use er_types::{
    AckStage, AuthorityEntryBody, AuthorityEntryKind, AuthorityFrontier, AuthorityReceiptBody,
    AwaitSuccessorControl, CancelPolicy, CommandControlTarget, CommandFrontierControl, CommandMenu,
    ConnectionGeneration, FRAME_PROTOCOL_VERSION, FrameContext, FrameType, GameButton, InputMap,
    KernelEffect, KeyBinding, LiveResourceSnapshot, Material, MembershipRevision, MenuGeneration,
    MenuOption, MenuOptionId, MenuState, NextControl, PhysicalKey, ProposalMessage, Revision,
    RunId, SafeI53, SafeU53, SeatId, SessionId, TimeClass, TimerId, UiIntent, UiState, UiViewKind,
    UiViewModel, WaitingMenu,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

struct DelayedRecoveryPair {
    pair: SimulatedPair,
    steps: Vec<PairStep>,
    recovery_timer_ids: BTreeSet<TimerId>,
    recovery_request_packet_id: SafeU53,
    recovery_start_time: SafeU53,
}

const HOST_SEAT: u64 = 1;
const GUEST_SEAT: u64 = 2;
const INITIAL_GENERATION: u64 = 0;
const RECONNECTED_GENERATION: u64 = 1;
const OPERATION_ID: &str = "m2b-08/reconnect";
const OPTION_ID: &str = "m2b-08/accept";
const PROPOSAL_WIRE_JSON: &str =
    r#"{"campaign":"m2b-08","option":"m2b-08/accept","wireVersion":1}"#;
const PROPOSAL_REWARD_SURFACE_JSON: &str =
    r#"{"campaign":"m2b-08","surface":"suspend-reconnect","version":1}"#;
const EXPECTED_PRODUCTION_FINGERPRINT: &str = concat!(
    r#"[8,"m2b-08.accept",0,{"campaign":"m2b-08","option":"m2b-08/accept","wireVersion":1},"#,
    r#"{"campaign":"m2b-08","surface":"suspend-reconnect","version":1}]"#,
);
const ABSOLUTE_PROPOSAL_CEILING_MS: u64 = 1_200_000;
const RECOVERY_REQUEST_TIMEOUT_MS: u64 = 300_000;
const EXPECTED_ABSOLUTE_TERMINAL_REASON: &str =
    "proposal m2b-08/reconnect terminalized: v2 proposal absolute ceiling";
const EXPECTED_RECOVERY_TERMINAL_REASON: &str = concat!(
    "recovery live frontier changed under the fence (captured AuthorityFrontier { received: ",
    "Revision(SafeU53(0)), material: Revision(SafeU53(0)), control: Revision(SafeU53(0)) }, ",
    "live AuthorityFrontier { received: Revision(SafeU53(1)), material: Revision(SafeU53(1)), ",
    "control: Revision(SafeU53(1)) })",
);

fn safe(value: u64) -> SafeU53 {
    assert!(value <= SafeU53::MAX.get());
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn operation_id() -> TestResult<er_types::OperationId> {
    Ok(er_types::OperationId::new(OPERATION_ID)?)
}

fn context(sender_seat: u64, connection_generation: u64) -> TestResult<FrameContext> {
    Ok(FrameContext {
        session_id: SessionId::new("m2b-08-session")?,
        run_id: RunId::new("m2b-08-run")?,
        session_epoch: safe(1),
        seat_map_id: "m2b-08-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender_seat),
        authority_seat_id: seat(HOST_SEAT),
        connection_generation: generation(connection_generation),
    })
}

fn authority_context() -> TestResult<FrameContext> {
    context(HOST_SEAT, INITIAL_GENERATION)
}

fn replica_context() -> TestResult<FrameContext> {
    context(GUEST_SEAT, INITIAL_GENERATION)
}

fn proposal_payload() -> Value {
    json!({
        "campaign": "m2b-08",
        "option": OPTION_ID,
        "wireVersion": 1,
    })
}

fn production_proposal_fingerprint() -> TestResult<String> {
    let fingerprint = proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(8),
        label: "m2b-08.accept".to_owned(),
        choice: SafeI53::ZERO,
        wire: Some(ProposalJson::new(PROPOSAL_WIRE_JSON)?),
        reward_surface: Some(ProposalJson::new(PROPOSAL_REWARD_SURFACE_JSON)?),
    })?;
    assert_eq!(fingerprint, EXPECTED_PRODUCTION_FINGERPRINT);
    Ok(fingerprint)
}

fn committed_material() -> Material {
    Material {
        digest: "digest-m2b-08".to_owned(),
        payload: json!({
            "epoch": 1,
            "wave": 1,
            "turn": 1,
            "fieldIndex": 0,
            "campaign": "m2b-08",
            "accepted": true,
        }),
    }
}

fn initial_control() -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(GUEST_SEAT),
            pokemon_id: safe(25),
            field_index: SafeU53::ZERO,
        }],
    })
}

fn successor_control() -> TestResult<NextControl> {
    Ok(NextControl::AwaitSuccessor(AwaitSuccessorControl {
        after_operation_id: operation_id()?,
        epoch: safe(1),
        wave: safe(1),
        turn: safe(1),
        allowed_kinds: vec![AuthorityEntryKind::TurnCommit],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: false,
        expected_operation_id: None,
    }))
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
            KeyBinding {
                key: PhysicalKey::Escape,
                button: GameButton::Cancel,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    }
}

fn command_options() -> TestResult<Vec<MenuOption>> {
    Ok(vec![MenuOption {
        id: MenuOptionId::new(OPTION_ID)?,
        label_key: "m2b-08.accept".to_owned(),
        enabled: true,
        visible: true,
    }])
}

fn command_menu() -> TestResult<MenuState> {
    Ok(MenuState::Command(CommandMenu {
        operation_id: operation_id()?,
        control_id: control_id_of(&initial_control()),
        cursor: SafeU53::ZERO,
        options: command_options()?,
        cancel: CancelPolicy::Disabled,
    }))
}

fn waiting_ui() -> UiState {
    UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: None,
        actionable: false,
        stack: vec![MenuState::Waiting(WaitingMenu { prompt_key: None })],
    }
}

fn replica_ui() -> TestResult<UiState> {
    Ok(UiState {
        generation: MenuGeneration::new(safe(1)),
        owner_seat: Some(seat(GUEST_SEAT)),
        actionable: true,
        stack: vec![command_menu()?],
    })
}

fn proposal_leases() -> ProposalLeaseConfig {
    ProposalLeaseConfig {
        owner_prefix: "m2b-08:proposal:".to_owned(),
        retry_initial_ms: safe(250),
        retry_maximum_ms: safe(5_000),
        absolute_ceiling_ms: safe(ABSOLUTE_PROPOSAL_CEILING_MS),
    }
}

fn recovery_config() -> TestResult<RecoveryTransactionConfig> {
    Ok(RecoveryTransactionConfig {
        local_context: replica_context()?,
        request_timeout_ms: safe(RECOVERY_REQUEST_TIMEOUT_MS),
        control_timeout_ms: safe(30_000),
        pacing_ms: safe(16),
        timer_owner_id: "m2b-08:recovery".to_owned(),
    })
}

fn authority_log() -> TestResult<AuthorityLogConfig> {
    Ok(AuthorityLogConfig {
        local_context: authority_context()?,
        peer_bindings: vec![PeerBinding {
            seat_id: seat(GUEST_SEAT),
            connection_generation: generation(INITIAL_GENERATION),
        }],
        owner_id: "m2b-08:authority".to_owned(),
        retain_capacity: safe(512),
        delivery_backoff: BackoffPolicy {
            initial_ms: safe(250),
            maximum_ms: safe(5_000),
            factor_numerator: safe(2),
            factor_denominator: safe(1),
        },
        delivery_time_class: TimeClass::Connected,
        max_delivery_attempts: None,
    })
}

fn resolution_plan() -> TestResult<AuthorityResolutionPlan> {
    Ok(AuthorityResolutionPlan {
        operation_id: operation_id()?,
        fingerprint: production_proposal_fingerprint()?,
        draft: AuthorityEntryDraft {
            context: authority_context()?,
            operation_id: operation_id()?,
            kind: AuthorityEntryKind::TurnCommit,
            material: committed_material(),
            next_control: successor_control()?,
            subsumes: Vec::new(),
        },
    })
}

fn menu_plan() -> TestResult<ControlMenuPlan> {
    Ok(ControlMenuPlan::Command {
        control_id: control_id_of(&initial_control()),
        owner_seat_id: seat(GUEST_SEAT),
        operation_id: operation_id()?,
        field_index: SafeU53::ZERO,
        options: command_options()?,
        proposals: vec![MenuProposalPlan {
            option_id: MenuOptionId::new(OPTION_ID)?,
            fingerprint: production_proposal_fingerprint()?,
            payload: proposal_payload(),
        }],
        cancel: CancelPolicy::Disabled,
    })
}

fn authority_kernel() -> TestResult<KernelConfig> {
    Ok(KernelConfig {
        input_map: input_map(),
        initial_ui: waiting_ui(),
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Authority {
                log: authority_log()?,
                proposal_capacity: safe(8),
                resolutions: vec![resolution_plan()?],
            },
            menu_plans: Vec::new(),
        }),
    })
}

fn replica_kernel() -> TestResult<KernelConfig> {
    Ok(KernelConfig {
        input_map: input_map(),
        initial_ui: replica_ui()?,
        protocol: Some(ProtocolKernelConfig {
            role: ProtocolRoleConfig::Replica {
                replica: AuthorityReplicaConfig {
                    receipt_context: replica_context()?,
                    authority_seat_id: seat(HOST_SEAT),
                    authority_connection_generation: generation(INITIAL_GENERATION),
                },
                proposal_leases: proposal_leases(),
                recovery: recovery_config()?,
            },
            menu_plans: vec![menu_plan()?],
        }),
    })
}

fn pair_config(seed: u64) -> TestResult<SimulatedPairConfig> {
    Ok(SimulatedPairConfig {
        host_kernel: authority_kernel()?,
        guest_kernel: replica_kernel()?,
        host_seat: seat(HOST_SEAT),
        guest_seat: seat(GUEST_SEAT),
        seed,
        presenter: PresenterMode::FaultControlled,
        initial_storage: BTreeMap::new(),
        event_budget: safe(4_096),
    })
}

fn record_step(steps: &mut Vec<PairStep>, step: PairStep) {
    if let Some(previous) = steps.last() {
        assert_eq!(
            previous.sequence.get().checked_add(1),
            Some(step.sequence.get())
        );
        assert!(step.snapshot.virtual_time_ms >= previous.snapshot.virtual_time_ms);
    }
    assert_eq!(step.sequence, step.snapshot.sequence);
    steps.push(step);
}

fn record_steps(steps: &mut Vec<PairStep>, new_steps: Vec<PairStep>) {
    for step in new_steps {
        record_step(steps, step);
    }
}

fn proposals_in(step: &PairStep) -> Vec<ProposalMessage> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal.clone()),
            _ => None,
        })
        .collect()
}

fn proposal_intents_in(steps: &[PairStep]) -> Vec<UiIntent> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent {
                endpoint,
                intent: intent @ UiIntent::CommandSubmitted { .. },
            } if *endpoint == seat(GUEST_SEAT) => Some(intent.clone()),
            _ => None,
        })
        .collect()
}

fn assert_complete_proposal(proposal: &ProposalMessage, expected_generation: u64) -> TestResult {
    assert_eq!(proposal.operation_id, operation_id()?);
    assert_eq!(proposal.fingerprint, production_proposal_fingerprint()?);
    assert_eq!(proposal.from, seat(GUEST_SEAT));
    assert_eq!(proposal.to, seat(HOST_SEAT));
    assert_eq!(
        proposal.connection_generation,
        generation(expected_generation)
    );
    assert_eq!(proposal.payload, proposal_payload());
    Ok(())
}

fn assert_stable_proposal_identity(original: &ProposalMessage, rebound: &ProposalMessage) {
    assert_eq!(rebound.operation_id, original.operation_id);
    assert_eq!(rebound.fingerprint, original.fingerprint);
    assert_eq!(rebound.from, original.from);
    assert_eq!(rebound.to, original.to);
    assert_eq!(rebound.payload, original.payload);
}

fn terminal_effect_count(step: &PairStep) -> usize {
    step.generated_effects
        .iter()
        .filter(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
        .count()
}

fn network_send_count(step: &PairStep) -> usize {
    step.generated_effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { .. } | KernelEffect::SendProposal { .. }
            )
        })
        .count()
}

fn timer_ids_for_class(step: &PairStep, time_class: TimeClass) -> BTreeSet<TimerId> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                timer_id,
                time_class: effect_class,
                ..
            } if *effect_class == time_class => Some(*timer_id),
            _ => None,
        })
        .collect()
}

fn live_timer_ids_for_class(step: &PairStep, time_class: TimeClass) -> BTreeSet<TimerId> {
    timer_ids_for_class(step, time_class)
        .intersection(&step.snapshot.guest.live_resources.timers)
        .copied()
        .collect()
}

fn timer_delays_for_class(step: &PairStep, time_class: TimeClass) -> Vec<SafeU53> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                delay_ms,
                time_class: effect_class,
                ..
            } if *effect_class == time_class => Some(*delay_ms),
            _ => None,
        })
        .collect()
}

fn assert_timers_live(snapshot: &PairSnapshot, timer_ids: &BTreeSet<TimerId>) {
    assert!(
        timer_ids
            .iter()
            .all(|timer_id| snapshot.guest.live_resources.timers.contains(timer_id))
    );
}

fn exact_state_path<'a>(state: &'a Value, endpoint: &str, path: &[&str]) -> TestResult<&'a Value> {
    let mut value = state;
    let mut traversed = format!("{endpoint}.kernel.state");
    for field in path {
        let object = value
            .as_object()
            .ok_or_else(|| format!("{traversed} must be an object"))?;
        value = object
            .get(*field)
            .ok_or_else(|| format!("{traversed}.{field} is missing"))?;
        traversed.push('.');
        traversed.push_str(field);
    }
    Ok(value)
}

fn exact_state_leaf<T>(state: &Value, endpoint: &str, path: &[&str]) -> TestResult<T>
where
    T: serde::de::DeserializeOwned,
{
    Ok(serde_json::from_value(
        exact_state_path(state, endpoint, path)?.clone(),
    )?)
}

fn assert_protocol_role(state: &Value, endpoint: &str, expected_role: &str) -> TestResult {
    let role: String = exact_state_leaf(state, endpoint, &["protocol", "role"])?;
    if role != expected_role {
        return Err(format!(
            "{endpoint}.kernel.state.protocol.role was {role:?}, expected {expected_role:?}"
        )
        .into());
    }
    Ok(())
}

fn assert_snapshot_bindings(snapshot: &PairSnapshot, expected_generation: u64) -> TestResult {
    let authority_state = &snapshot.host.kernel.state;
    assert_protocol_role(authority_state, "host", "authority")?;
    let authority_context: FrameContext =
        exact_state_leaf(authority_state, "host", &["protocol", "context"])?;
    assert_eq!(authority_context, context(HOST_SEAT, expected_generation)?);
    let peer_bindings: Vec<PeerBinding> =
        exact_state_leaf(authority_state, "host", &["protocol", "peerBindings"])?;
    assert_eq!(
        peer_bindings,
        vec![PeerBinding {
            seat_id: seat(GUEST_SEAT),
            connection_generation: generation(expected_generation),
        }]
    );

    let replica_state = &snapshot.guest.kernel.state;
    assert_protocol_role(replica_state, "guest", "replica")?;
    let replica_context: FrameContext =
        exact_state_leaf(replica_state, "guest", &["protocol", "context"])?;
    assert_eq!(replica_context, context(GUEST_SEAT, expected_generation)?);
    let authority_generation: ConnectionGeneration =
        exact_state_leaf(replica_state, "guest", &["protocol", "authorityGeneration"])?;
    assert_eq!(authority_generation, generation(expected_generation));
    Ok(())
}

fn assert_authority_head_revision(snapshot: &PairSnapshot, expected_revision: u64) -> TestResult {
    let authority_state = &snapshot.host.kernel.state;
    assert_protocol_role(authority_state, "host", "authority")?;
    let head_revision: Revision = exact_state_leaf(
        authority_state,
        "host",
        &["protocol", "log", "headRevision"],
    )?;
    assert_eq!(head_revision, Revision::new(safe(expected_revision)));
    Ok(())
}

fn assert_replica_frontier(
    snapshot: &PairSnapshot,
    expected_received: u64,
    expected_material: u64,
    expected_control: u64,
) -> TestResult {
    let replica_state = &snapshot.guest.kernel.state;
    assert_protocol_role(replica_state, "guest", "replica")?;
    let frontier: AuthorityFrontier =
        exact_state_leaf(replica_state, "guest", &["protocol", "replica", "frontier"])?;
    assert_eq!(
        frontier,
        AuthorityFrontier {
            received: Revision::new(safe(expected_received)),
            material: Revision::new(safe(expected_material)),
            control: Revision::new(safe(expected_control)),
        }
    );
    Ok(())
}

fn assert_absorbed_snapshot_unchanged(expected: &PairSnapshot, actual: &PairSnapshot) {
    assert_eq!(actual.seed, expected.seed);
    assert_eq!(actual.virtual_time_ms, expected.virtual_time_ms);
    assert_eq!(actual.host, expected.host);
    assert_eq!(actual.guest, expected.guest);
    assert_eq!(actual.network, expected.network);
    assert_eq!(actual.clock_timers, expected.clock_timers);
    assert_eq!(actual.presenter, expected.presenter);
    assert_eq!(actual.storage, expected.storage);
    assert_eq!(actual.terminal_reason, expected.terminal_reason);
}

fn capture_guest_actionable_menu(
    snapshot: &PairSnapshot,
) -> TestResult<(UiState, UiViewModel, SeatId, String, SafeU53)> {
    assert!(snapshot.guest.kernel.ui.actionable);
    assert!(snapshot.guest.ui.actionable);
    let owner = snapshot
        .guest
        .kernel
        .ui
        .owner_seat
        .ok_or("actionable guest menu has no owner")?;
    let Some(MenuState::Command(menu)) = snapshot.guest.kernel.ui.stack.last() else {
        return Err("actionable guest menu is not a command menu".into());
    };
    assert_eq!(snapshot.guest.ui.owner_seat, Some(owner));
    assert_eq!(snapshot.guest.ui.kind, UiViewKind::Command);
    assert_eq!(snapshot.guest.ui.cursor, Some(menu.cursor));
    Ok((
        snapshot.guest.kernel.ui.clone(),
        snapshot.guest.ui.clone(),
        owner,
        menu.control_id.clone(),
        menu.cursor,
    ))
}

fn assert_guest_menu_unchanged(
    snapshot: &PairSnapshot,
    expected_kernel_ui: &UiState,
    expected_view: &UiViewModel,
    expected_owner: SeatId,
    expected_control_id: &str,
    expected_cursor: SafeU53,
) -> TestResult {
    assert_eq!(&snapshot.guest.kernel.ui, expected_kernel_ui);
    assert_eq!(&snapshot.guest.ui, expected_view);
    assert!(snapshot.guest.kernel.ui.actionable);
    assert!(snapshot.guest.ui.actionable);
    assert_eq!(snapshot.guest.kernel.ui.owner_seat, Some(expected_owner));
    assert_eq!(snapshot.guest.ui.owner_seat, Some(expected_owner));
    let Some(MenuState::Command(menu)) = snapshot.guest.kernel.ui.stack.last() else {
        return Err("guest menu changed away from the captured command menu".into());
    };
    assert_eq!(menu.control_id.as_str(), expected_control_id);
    assert_eq!(menu.cursor, expected_cursor);
    assert_eq!(snapshot.guest.ui.kind, UiViewKind::Command);
    assert_eq!(snapshot.guest.ui.cursor, Some(expected_cursor));
    Ok(())
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

fn assert_post_disposal_rejected(pair: &mut SimulatedPair) {
    assert!(matches!(pair.snapshot(), Err(SimulatedPairError::Disposed)));
    assert!(matches!(
        pair.advance_time(SafeU53::ZERO),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.key_down(PairEndpoint::Guest, PhysicalKey::Enter, false),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        }),
        Err(SimulatedPairError::Disposed)
    ));
    assert!(matches!(
        pair.teardown("m2b-08 repeated teardown"),
        Err(SimulatedPairError::Disposed)
    ));
}

fn new_protocol_pair(seed: u64) -> TestResult<SimulatedPair> {
    let pair = SimulatedPair::new(pair_config(seed)?)?;
    let initial = pair.snapshot()?;
    assert_eq!(initial.seed, seed.to_string());
    assert_eq!(initial.network.seed, seed.to_string());
    assert_eq!(initial.virtual_time_ms, SafeU53::ZERO);
    assert_eq!(initial.host.ui.kind, UiViewKind::Waiting);
    assert_eq!(initial.guest.ui.kind, UiViewKind::Command);
    assert_eq!(initial.guest.ui.owner_seat, Some(seat(GUEST_SEAT)));
    assert!(initial.guest.ui.actionable);
    assert_replica_frontier(&initial, 0, 0, 0)?;
    assert_snapshot_bindings(&initial, INITIAL_GENERATION)?;
    Ok(pair)
}

fn submit_proposal(
    pair: &mut SimulatedPair,
    steps: &mut Vec<PairStep>,
) -> TestResult<ProposalMessage> {
    let first_new_step = steps.len();
    record_steps(steps, pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?);
    let submission_steps = &steps[first_new_step..];
    assert_eq!(
        proposal_intents_in(submission_steps),
        vec![UiIntent::CommandSubmitted {
            seat: seat(GUEST_SEAT),
            generation: MenuGeneration::new(safe(1)),
            operation_id: operation_id()?,
            control_id: control_id_of(&initial_control()),
            option_id: MenuOptionId::new(OPTION_ID)?,
        }]
    );
    let mut proposals = submission_steps
        .iter()
        .flat_map(proposals_in)
        .collect::<Vec<_>>();
    if proposals.len() != 1 {
        return Err("raw command input did not emit exactly one proposal".into());
    }
    let proposal = proposals.remove(0);
    assert_complete_proposal(&proposal, INITIAL_GENERATION)?;
    let submission = submission_steps
        .iter()
        .find(|step| !proposals_in(step).is_empty())
        .ok_or("proposal effect did not have a pair step")?;
    assert!(
        submission
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&proposal.operation_id)
    );
    assert_eq!(
        timer_delays_for_class(submission, TimeClass::Connected),
        vec![safe(250)]
    );
    assert_eq!(
        timer_delays_for_class(submission, TimeClass::Absolute),
        vec![safe(ABSOLUTE_PROPOSAL_CEILING_MS)]
    );
    assert!(!submission.snapshot.network.queued_packet_ids.is_empty());
    Ok(proposal)
}

fn initial_protocol_pair(seed: u64) -> TestResult<(SimulatedPair, Vec<PairStep>, ProposalMessage)> {
    let mut pair = new_protocol_pair(seed)?;
    let mut steps = Vec::new();
    let proposal = submit_proposal(&mut pair, &mut steps)?;
    Ok((pair, steps, proposal))
}

fn delay_all_queued(
    pair: &mut SimulatedPair,
    steps: &mut Vec<PairStep>,
    additional_ms: SafeU53,
) -> TestResult {
    let packet_ids = pair
        .snapshot()?
        .network
        .queued_packet_ids
        .into_iter()
        .collect::<Vec<_>>();
    for packet_id in packet_ids {
        let step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Delay {
                packet_id,
                additional_ms,
            },
        })?;
        record_step(steps, step);
    }
    Ok(())
}

fn newly_enqueued_packet_ids(before: &BTreeSet<SafeU53>, step: &PairStep) -> Vec<SafeU53> {
    step.snapshot
        .network
        .queued_packet_ids
        .difference(before)
        .copied()
        .collect()
}

fn packet_ids_for_sends<F>(
    before: &BTreeSet<SafeU53>,
    step: &PairStep,
    mut predicate: F,
) -> TestResult<Vec<SafeU53>>
where
    F: FnMut(&KernelEffect) -> bool,
{
    let sends = step
        .generated_effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { .. } | KernelEffect::SendProposal { .. }
            )
        })
        .collect::<Vec<_>>();
    let packet_ids = newly_enqueued_packet_ids(before, step);
    if sends.len() != packet_ids.len() {
        return Err("network send effects did not map exactly to new packet ids".into());
    }
    Ok(sends
        .into_iter()
        .zip(packet_ids)
        .filter_map(|(effect, packet_id)| predicate(effect).then_some(packet_id))
        .collect())
}

fn authority_entries(
    step: &PairStep,
) -> TestResult<Vec<(SeatId, u32, FrameContext, AuthorityEntryBody)>> {
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
    Ok(entries)
}

fn assert_exact_authority_entry(step: &PairStep, expected_generation: u64) -> TestResult {
    let authority_effect_order = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial { endpoint, .. } => {
                (*endpoint == seat(HOST_SEAT)).then_some("material")
            }
            KernelEffect::ProjectAuthorityControl { endpoint, .. } => {
                (*endpoint == seat(HOST_SEAT)).then_some("control")
            }
            KernelEffect::SendFrame { from, frame } => (*from == seat(HOST_SEAT)
                && frame.frame_type == FrameType::AuthorityEntry)
                .then_some("authorityEntry"),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        authority_effect_order,
        vec!["material", "authorityEntry", "control"]
    );
    assert_eq!(
        authority_entries(step)?,
        vec![(
            seat(HOST_SEAT),
            FRAME_PROTOCOL_VERSION,
            context(HOST_SEAT, expected_generation)?,
            AuthorityEntryBody {
                revision: Revision::new(safe(1)),
                operation_id: operation_id()?,
                kind: AuthorityEntryKind::TurnCommit,
                material: committed_material(),
                next_control: successor_control()?,
                subsumes: Vec::new(),
            },
        )]
    );
    Ok(())
}

fn assert_exact_material_and_control(step: &PairStep, endpoint: SeatId) -> TestResult {
    let materials = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint: effect_endpoint,
                revision,
                operation_id,
                material,
            } if *effect_endpoint == endpoint => {
                Some((*revision, operation_id.clone(), material.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        materials,
        vec![(
            Revision::new(safe(1)),
            operation_id()?,
            committed_material()
        )]
    );

    let controls = step
        .generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ProjectAuthorityControl {
                endpoint: effect_endpoint,
                revision,
                operation_id,
                control,
            } if *effect_endpoint == endpoint => {
                Some((*revision, operation_id.clone(), control.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        controls,
        vec![(
            Revision::new(safe(1)),
            operation_id()?,
            successor_control()?
        )]
    );
    assert_eq!(
        controls
            .first()
            .map(|(_, _, control)| control_id_of(control)),
        Some(control_id_of(&successor_control()?))
    );
    Ok(())
}

fn authority_receipts(
    step: &PairStep,
) -> TestResult<Vec<(SeatId, u32, FrameContext, AuthorityReceiptBody)>> {
    let mut receipts = Vec::new();
    for effect in &step.generated_effects {
        if let KernelEffect::SendFrame { from, frame } = effect
            && frame.frame_type == FrameType::AuthorityReceipt
        {
            receipts.push((
                *from,
                frame.version,
                frame.context.clone(),
                serde_json::from_value::<AuthorityReceiptBody>(frame.body.clone())?,
            ));
        }
    }
    Ok(receipts)
}

fn expected_receipt(
    stage: AckStage,
    control_id: Option<String>,
) -> TestResult<(SeatId, u32, FrameContext, AuthorityReceiptBody)> {
    Ok((
        seat(GUEST_SEAT),
        FRAME_PROTOCOL_VERSION,
        context(GUEST_SEAT, RECONNECTED_GENERATION)?,
        AuthorityReceiptBody {
            revision: Revision::new(safe(1)),
            operation_id: operation_id()?,
            stage,
            control_id,
        },
    ))
}

fn assert_exact_receipts(step: &PairStep) -> TestResult {
    assert_eq!(
        authority_receipts(step)?,
        vec![
            expected_receipt(AckStage::Admitted, None)?,
            expected_receipt(AckStage::MaterialApplied, None)?,
            expected_receipt(
                AckStage::ControlInstalled,
                Some(control_id_of(&successor_control()?)),
            )?,
        ]
    );
    Ok(())
}

#[test]
fn raw_suspend_resume_preserves_all_mechanical_delays_while_absolute_advances() -> TestResult {
    let mut pair = new_protocol_pair(0x0123_4567_89ab_cdef)?;
    let mut steps = Vec::new();

    let key_down = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?;
    assert_eq!(
        timer_delays_for_class(&key_down, TimeClass::HumanInput),
        vec![safe(250)]
    );
    let human_timer_ids = live_timer_ids_for_class(&key_down, TimeClass::HumanInput);
    assert!(!human_timer_ids.is_empty());
    record_step(&mut steps, key_down);

    let proposal = submit_proposal(&mut pair, &mut steps)?;
    let submission = steps
        .iter()
        .rev()
        .find(|step| !proposals_in(step).is_empty())
        .ok_or("proposal submission step was not recorded")?;
    let connected_timer_ids = live_timer_ids_for_class(submission, TimeClass::Connected);
    let absolute_timer_ids = live_timer_ids_for_class(submission, TimeClass::Absolute);
    assert!(!connected_timer_ids.is_empty());
    assert!(!absolute_timer_ids.is_empty());
    assert_timers_live(&submission.snapshot, &human_timer_ids);

    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;
    let before_suspend = pair.snapshot()?;
    let queue_before_suspend = before_suspend.network.queued_packet_ids.clone();
    let (
        guest_kernel_ui_before_suspend,
        guest_view_before_suspend,
        guest_owner_before_suspend,
        guest_control_before_suspend,
        guest_cursor_before_suspend,
    ) = capture_guest_actionable_menu(&before_suspend)?;
    let suspend_step = pair.apply(PairOperation::Suspend {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        suspend_step
            .snapshot
            .network
            .suspended_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    assert_guest_menu_unchanged(
        &suspend_step.snapshot,
        &guest_kernel_ui_before_suspend,
        &guest_view_before_suspend,
        guest_owner_before_suspend,
        &guest_control_before_suspend,
        guest_cursor_before_suspend,
    )?;
    record_step(&mut steps, suspend_step);

    let suspended_advance = pair.advance_time(safe(60_000))?;
    assert_eq!(suspended_advance.snapshot.virtual_time_ms, safe(60_000));
    assert_eq!(network_send_count(&suspended_advance), 0);
    assert_eq!(
        suspended_advance.snapshot.network.queued_packet_ids,
        queue_before_suspend
    );
    assert_timers_live(&suspended_advance.snapshot, &human_timer_ids);
    assert_timers_live(&suspended_advance.snapshot, &connected_timer_ids);
    assert_timers_live(&suspended_advance.snapshot, &absolute_timer_ids);
    assert_eq!(terminal_effect_count(&suspended_advance), 0);
    assert_guest_menu_unchanged(
        &suspended_advance.snapshot,
        &guest_kernel_ui_before_suspend,
        &guest_view_before_suspend,
        guest_owner_before_suspend,
        &guest_control_before_suspend,
        guest_cursor_before_suspend,
    )?;
    assert!(
        suspended_advance
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&proposal.operation_id)
    );
    record_step(&mut steps, suspended_advance);

    let resume_step = pair.apply(PairOperation::Resume {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(resume_step.snapshot.network.suspended_endpoints.is_empty());
    assert_guest_menu_unchanged(
        &resume_step.snapshot,
        &guest_kernel_ui_before_suspend,
        &guest_view_before_suspend,
        guest_owner_before_suspend,
        &guest_control_before_suspend,
        guest_cursor_before_suspend,
    )?;
    record_step(&mut steps, resume_step);

    let before_deadline = pair.advance_time(safe(249))?;
    assert_eq!(before_deadline.snapshot.virtual_time_ms, safe(60_249));
    assert_eq!(network_send_count(&before_deadline), 0);
    assert_timers_live(&before_deadline.snapshot, &human_timer_ids);
    assert_timers_live(&before_deadline.snapshot, &connected_timer_ids);
    record_step(&mut steps, before_deadline);

    let exact_continuation = pair.advance_time(safe(1))?;
    assert_eq!(exact_continuation.snapshot.virtual_time_ms, safe(60_250));
    assert_eq!(
        timer_delays_for_class(&exact_continuation, TimeClass::HumanInput),
        vec![safe(250)]
    );
    let rebound = proposals_in(&exact_continuation)
        .into_iter()
        .find(|candidate| candidate.operation_id == proposal.operation_id)
        .ok_or("connected retry did not continue at exactly 250 ms")?;
    assert_stable_proposal_identity(&proposal, &rebound);
    assert_complete_proposal(&rebound, INITIAL_GENERATION)?;
    let post_retry_connected_ids =
        live_timer_ids_for_class(&exact_continuation, TimeClass::Connected);
    assert!(!post_retry_connected_ids.is_empty());
    assert!(timer_delays_for_class(&exact_continuation, TimeClass::Connected).contains(&safe(500)));
    record_step(&mut steps, exact_continuation);
    let key_up = pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?;
    record_step(&mut steps, key_up);

    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;
    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        disconnect_step
            .snapshot
            .network
            .disconnected_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    let queue_before_disconnected_advance =
        disconnect_step.snapshot.network.queued_packet_ids.clone();
    let dropped_before_disconnected_advance = disconnect_step.snapshot.network.dropped_count;
    record_step(&mut steps, disconnect_step);
    let disconnected_advance = pair.advance_time(safe(10_000))?;
    assert_eq!(disconnected_advance.snapshot.virtual_time_ms, safe(70_250));
    assert_eq!(network_send_count(&disconnected_advance), 0);
    assert!(
        disconnected_advance
            .snapshot
            .network
            .queued_packet_ids
            .is_empty()
    );
    assert_eq!(
        disconnected_advance.snapshot.network.dropped_count,
        safe(
            dropped_before_disconnected_advance
                .get()
                .checked_add(queue_before_disconnected_advance.len() as u64)
                .ok_or("stale packet drop counter overflowed")?
        )
    );
    assert_eq!(terminal_effect_count(&disconnected_advance), 0);
    assert_timers_live(&disconnected_advance.snapshot, &post_retry_connected_ids);
    assert_timers_live(&disconnected_advance.snapshot, &absolute_timer_ids);
    record_step(&mut steps, disconnected_advance);

    let reconnect_step = pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    let rebound = proposals_in(&reconnect_step)
        .into_iter()
        .find(|candidate| candidate.operation_id == proposal.operation_id)
        .ok_or("reconnect did not rebind the retained proposal")?;
    assert_stable_proposal_identity(&proposal, &rebound);
    assert_complete_proposal(&rebound, RECONNECTED_GENERATION)?;
    let recovery_timer_ids = live_timer_ids_for_class(&reconnect_step, TimeClass::Recovery);
    assert!(!recovery_timer_ids.is_empty());
    assert_snapshot_bindings(&reconnect_step.snapshot, RECONNECTED_GENERATION)?;
    record_step(&mut steps, reconnect_step);

    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;
    let queue_before_recovery_suspend = pair.snapshot()?.network.queued_packet_ids;
    let recovery_suspend = pair.apply(PairOperation::Suspend {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        recovery_suspend
            .snapshot
            .network
            .suspended_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    record_step(&mut steps, recovery_suspend);
    let recovery_suspended_advance = pair.advance_time(safe(60_000))?;
    assert_eq!(
        recovery_suspended_advance.snapshot.virtual_time_ms,
        safe(130_250)
    );
    assert_eq!(network_send_count(&recovery_suspended_advance), 0);
    assert_eq!(
        recovery_suspended_advance
            .snapshot
            .network
            .queued_packet_ids,
        queue_before_recovery_suspend
    );
    assert_timers_live(&recovery_suspended_advance.snapshot, &recovery_timer_ids);
    assert_timers_live(
        &recovery_suspended_advance.snapshot,
        &post_retry_connected_ids,
    );
    assert_timers_live(&recovery_suspended_advance.snapshot, &absolute_timer_ids);
    record_step(&mut steps, recovery_suspended_advance);
    let recovery_resume = pair.apply(PairOperation::Resume {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        recovery_resume
            .snapshot
            .network
            .suspended_endpoints
            .is_empty()
    );
    assert_eq!(network_send_count(&recovery_resume), 0);
    record_step(&mut steps, recovery_resume);

    let final_snapshot = pair.teardown("m2b-08 suspend campaign complete")?;
    assert_zero_resources(&final_snapshot);
    assert_post_disposal_rejected(&mut pair);
    Ok(())
}

fn delayed_recovery_pair(seed: u64) -> TestResult<DelayedRecoveryPair> {
    let (mut pair, mut steps, proposal) = initial_protocol_pair(seed)?;
    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;

    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        disconnect_step
            .snapshot
            .network
            .disconnected_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    record_step(&mut steps, disconnect_step);

    let disconnected_advance = pair.advance_time(safe(10_000))?;
    assert_eq!(disconnected_advance.snapshot.virtual_time_ms, safe(10_000));
    assert_eq!(terminal_effect_count(&disconnected_advance), 0);
    record_step(&mut steps, disconnected_advance);

    let before_reconnect = pair.snapshot()?;
    let reconnect_step = pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    let rebound = proposals_in(&reconnect_step)
        .into_iter()
        .find(|candidate| candidate.operation_id == proposal.operation_id)
        .ok_or("reconnect did not rebind the retained proposal")?;
    assert_stable_proposal_identity(&proposal, &rebound);
    assert_complete_proposal(&rebound, RECONNECTED_GENERATION)?;
    let recovery_timer_ids = live_timer_ids_for_class(&reconnect_step, TimeClass::Recovery);
    assert!(!recovery_timer_ids.is_empty());
    assert_eq!(
        timer_delays_for_class(&reconnect_step, TimeClass::Recovery),
        vec![safe(RECOVERY_REQUEST_TIMEOUT_MS)]
    );
    let recovery_request_packet_ids = packet_ids_for_sends(
        &before_reconnect.network.queued_packet_ids,
        &reconnect_step,
        |effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::RecoveryRequest
            )
        },
    )?;
    assert_eq!(recovery_request_packet_ids.len(), 1);
    assert_snapshot_bindings(&reconnect_step.snapshot, RECONNECTED_GENERATION)?;
    let recovery_start_time = reconnect_step.snapshot.virtual_time_ms;
    let recovery_request_packet_id = recovery_request_packet_ids
        .first()
        .copied()
        .ok_or("recovery request packet id was not retained")?;
    record_step(&mut steps, reconnect_step);

    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;
    assert!(
        pair.snapshot()?
            .network
            .queued_packet_ids
            .contains(&recovery_request_packet_id)
    );
    Ok(DelayedRecoveryPair {
        pair,
        steps,
        recovery_timer_ids,
        recovery_request_packet_id,
        recovery_start_time,
    })
}

fn assert_terminal_ui_semantics(
    host_kernel_ui: &UiState,
    guest_kernel_ui: &UiState,
    host_view: &UiViewModel,
    guest_view: &UiViewModel,
    expected_reason: &str,
) -> TestResult {
    // Menu generations are endpoint-local stale-input fences, so compare only
    // the semantic fields shared by the two terminal projections.
    assert_eq!(host_kernel_ui.owner_seat, guest_kernel_ui.owner_seat);
    assert_eq!(host_kernel_ui.actionable, guest_kernel_ui.actionable);
    assert_eq!(host_kernel_ui.stack, guest_kernel_ui.stack);
    assert_eq!(host_view.owner_seat, guest_view.owner_seat);
    assert_eq!(host_view.actionable, guest_view.actionable);
    assert_eq!(host_view.kind, guest_view.kind);
    assert_eq!(host_view.cursor, guest_view.cursor);
    assert_eq!(host_view.options, guest_view.options);
    assert_eq!(host_view.prompt_key, guest_view.prompt_key);

    for (endpoint, kernel_ui, view) in [
        ("host", host_kernel_ui, host_view),
        ("guest", guest_kernel_ui, guest_view),
    ] {
        assert_eq!(kernel_ui.generation, view.generation);
        assert_eq!(view.kind, UiViewKind::Terminal);
        assert!(!view.actionable);
        assert_eq!(view.owner_seat, None);
        assert_eq!(view.cursor, None);
        assert!(view.options.is_empty());
        assert_eq!(view.prompt_key.as_deref(), Some(expected_reason));
        assert_eq!(kernel_ui.owner_seat, None);
        assert!(!kernel_ui.actionable);
        assert_eq!(kernel_ui.stack.len(), 1);
        match kernel_ui.stack.first() {
            Some(MenuState::Terminal(menu)) => {
                assert_eq!(menu.prompt_key.as_deref(), Some(expected_reason));
            }
            other => {
                return Err(format!(
                    "{endpoint} terminal kernel UI was not a terminal menu: {other:?}"
                )
                .into());
            }
        }
    }
    Ok(())
}

#[test]
fn raw_recovery_request_timeout_pauses_while_suspended_and_terminalizes_once() -> TestResult {
    let DelayedRecoveryPair {
        mut pair,
        mut steps,
        recovery_timer_ids,
        recovery_request_packet_id,
        recovery_start_time,
    } = delayed_recovery_pair(0x2468_ace0)?;
    let suspended_virtual_ms = 60_000_u64;
    let before_suspend = pair.snapshot()?;
    let active_recovery_before_suspend = before_suspend
        .virtual_time_ms
        .get()
        .checked_sub(recovery_start_time.get())
        .ok_or("recovery start time was after the suspension point")?;
    assert_eq!(active_recovery_before_suspend, 0);
    assert_eq!(before_suspend.virtual_time_ms, recovery_start_time);
    assert_timers_live(&before_suspend, &recovery_timer_ids);
    assert!(
        before_suspend
            .network
            .queued_packet_ids
            .contains(&recovery_request_packet_id)
    );

    let suspend_step = pair.apply(PairOperation::Suspend {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        suspend_step
            .snapshot
            .network
            .suspended_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    assert_timers_live(&suspend_step.snapshot, &recovery_timer_ids);
    assert_eq!(terminal_effect_count(&suspend_step), 0);
    record_step(&mut steps, suspend_step);

    let suspended_advance = pair.advance_time(safe(suspended_virtual_ms))?;
    assert_eq!(
        suspended_advance.snapshot.virtual_time_ms,
        safe(recovery_start_time.get() + suspended_virtual_ms)
    );
    assert_eq!(terminal_effect_count(&suspended_advance), 0);
    assert!(suspended_advance.snapshot.terminal_reason.is_none());
    assert_timers_live(&suspended_advance.snapshot, &recovery_timer_ids);
    assert!(
        suspended_advance
            .snapshot
            .network
            .queued_packet_ids
            .contains(&recovery_request_packet_id)
    );
    record_step(&mut steps, suspended_advance);

    let resume_step = pair.apply(PairOperation::Resume {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(resume_step.snapshot.network.suspended_endpoints.is_empty());
    assert_eq!(
        resume_step.snapshot.virtual_time_ms,
        safe(recovery_start_time.get() + suspended_virtual_ms)
    );
    assert_eq!(terminal_effect_count(&resume_step), 0);
    assert_timers_live(&resume_step.snapshot, &recovery_timer_ids);
    assert!(
        resume_step
            .snapshot
            .network
            .queued_packet_ids
            .contains(&recovery_request_packet_id)
    );
    let elapsed_virtual_ms = resume_step
        .snapshot
        .virtual_time_ms
        .get()
        .checked_sub(recovery_start_time.get())
        .ok_or("recovery start time was after resume")?;
    assert_eq!(elapsed_virtual_ms, suspended_virtual_ms);
    let recovery_active_after_resume = elapsed_virtual_ms
        .checked_sub(suspended_virtual_ms)
        .ok_or("suspended time exceeded elapsed recovery time")?;
    assert_eq!(recovery_active_after_resume, active_recovery_before_suspend);
    let recovery_timeout_ms = safe(RECOVERY_REQUEST_TIMEOUT_MS);
    let remaining_recovery_ms = recovery_timeout_ms
        .get()
        .checked_sub(recovery_active_after_resume)
        .ok_or("recovery timeout was already exceeded before resume")?;
    assert_eq!(remaining_recovery_ms, RECOVERY_REQUEST_TIMEOUT_MS);
    record_step(&mut steps, resume_step);

    let before_timeout = pair.advance_time(safe(remaining_recovery_ms - 1))?;
    assert_eq!(
        before_timeout.snapshot.virtual_time_ms,
        safe(recovery_start_time.get() + suspended_virtual_ms + remaining_recovery_ms - 1)
    );
    assert_eq!(terminal_effect_count(&before_timeout), 0);
    assert!(before_timeout.snapshot.terminal_reason.is_none());
    assert_timers_live(&before_timeout.snapshot, &recovery_timer_ids);
    assert!(
        before_timeout
            .snapshot
            .network
            .queued_packet_ids
            .contains(&recovery_request_packet_id)
    );
    record_step(&mut steps, before_timeout);

    let terminal_step = pair.advance_time(safe(1))?;
    assert_eq!(
        terminal_step.snapshot.virtual_time_ms,
        safe(recovery_start_time.get() + suspended_virtual_ms + remaining_recovery_ms)
    );
    assert_eq!(terminal_effect_count(&terminal_step), 1);
    assert_eq!(
        terminal_step.snapshot.terminal_reason.as_deref(),
        Some(EXPECTED_RECOVERY_TERMINAL_REASON)
    );
    assert_eq!(terminal_step.snapshot.host.ui.kind, UiViewKind::Terminal);
    assert_eq!(terminal_step.snapshot.guest.ui.kind, UiViewKind::Terminal);
    assert_terminal_ui_semantics(
        &terminal_step.snapshot.host.kernel.ui,
        &terminal_step.snapshot.guest.kernel.ui,
        &terminal_step.snapshot.host.ui,
        &terminal_step.snapshot.guest.ui,
        EXPECTED_RECOVERY_TERMINAL_REASON,
    )?;
    let terminal_snapshot = terminal_step.snapshot.clone();
    let terminal_reason = terminal_step.snapshot.terminal_reason.clone();
    record_step(&mut steps, terminal_step);

    let repeated_timer_step = pair.advance_time(SafeU53::ZERO)?;
    assert_eq!(terminal_effect_count(&repeated_timer_step), 0);
    assert_absorbed_snapshot_unchanged(&terminal_snapshot, &repeated_timer_step.snapshot);
    record_step(&mut steps, repeated_timer_step);

    let rejected_input_steps = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert!(!rejected_input_steps.is_empty());
    assert!(
        rejected_input_steps
            .iter()
            .all(|step| step.generated_effects.is_empty())
    );
    for step in &rejected_input_steps {
        assert_absorbed_snapshot_unchanged(&terminal_snapshot, &step.snapshot);
    }
    record_steps(&mut steps, rejected_input_steps);
    assert_eq!(steps.iter().map(terminal_effect_count).sum::<usize>(), 1);

    let final_snapshot = pair.teardown("m2b-08 recovery timeout campaign complete")?;
    assert_zero_resources(&final_snapshot);
    assert_eq!(final_snapshot.terminal_reason, terminal_reason);
    assert_post_disposal_rejected(&mut pair);
    Ok(())
}

fn run_reconnect_campaign(seed: u64) -> TestResult<(Vec<PairStep>, PairSnapshot)> {
    let (mut pair, mut steps, original_proposal) = initial_protocol_pair(seed)?;
    let old_packet_ids = pair.snapshot()?.network.queued_packet_ids;
    assert!(!old_packet_ids.is_empty());
    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;

    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        disconnect_step
            .snapshot
            .network
            .disconnected_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    let before_reconnect_ids = disconnect_step.snapshot.network.queued_packet_ids.clone();
    record_step(&mut steps, disconnect_step);

    let reconnect_step = pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    let rebound = proposals_in(&reconnect_step)
        .into_iter()
        .find(|candidate| candidate.operation_id == original_proposal.operation_id)
        .ok_or("reconnect did not resend the retained proposal")?;
    assert_stable_proposal_identity(&original_proposal, &rebound);
    assert_complete_proposal(&rebound, RECONNECTED_GENERATION)?;
    assert!(
        reconnect_step
            .snapshot
            .network
            .disconnected_endpoints
            .is_empty()
    );
    assert_replica_frontier(&reconnect_step.snapshot, 0, 0, 0)?;
    assert_snapshot_bindings(&reconnect_step.snapshot, RECONNECTED_GENERATION)?;
    let fresh_proposal_packet_ids =
        packet_ids_for_sends(&before_reconnect_ids, &reconnect_step, |effect| {
            matches!(
                effect,
                KernelEffect::SendProposal { proposal }
                    if proposal.operation_id == original_proposal.operation_id
                        && proposal.connection_generation
                            == generation(RECONNECTED_GENERATION)
            )
        })?;
    assert_eq!(fresh_proposal_packet_ids.len(), 1);
    let fresh_proposal_packet_id = fresh_proposal_packet_ids
        .first()
        .copied()
        .ok_or("fresh proposal packet id was not retained")?;
    record_step(&mut steps, reconnect_step);

    let stale_packet_ids = pair
        .snapshot()?
        .network
        .queued_packet_ids
        .intersection(&old_packet_ids)
        .copied()
        .collect::<Vec<_>>();
    assert!(!stale_packet_ids.is_empty());
    assert_eq!(
        stale_packet_ids.iter().copied().collect::<BTreeSet<_>>(),
        old_packet_ids
    );
    let mut dropped_after_stale = pair.snapshot()?.network.dropped_count;
    for stale_packet_id in stale_packet_ids {
        let stale_step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver {
                packet_id: stale_packet_id,
            },
        })?;
        assert_eq!(
            dropped_after_stale.get().checked_add(1),
            Some(stale_step.snapshot.network.dropped_count.get())
        );
        assert!(stale_step.generated_effects.is_empty());
        assert_replica_frontier(&stale_step.snapshot, 0, 0, 0)?;
        assert!(
            stale_step
                .snapshot
                .guest
                .live_resources
                .proposal_leases
                .contains(&original_proposal.operation_id)
        );
        dropped_after_stale = stale_step.snapshot.network.dropped_count;
        record_step(&mut steps, stale_step);
    }

    let before_fresh_proposal = pair.snapshot()?.network.queued_packet_ids;
    let fresh_proposal_step = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: fresh_proposal_packet_id,
        },
    })?;
    assert_eq!(
        fresh_proposal_step.snapshot.network.dropped_count,
        dropped_after_stale
    );
    assert_exact_authority_entry(&fresh_proposal_step, RECONNECTED_GENERATION)?;
    assert_exact_material_and_control(&fresh_proposal_step, seat(HOST_SEAT))?;
    assert_replica_frontier(&fresh_proposal_step.snapshot, 0, 0, 0)?;
    assert_authority_head_revision(&fresh_proposal_step.snapshot, 1)?;
    let authority_entry_packet_ids =
        packet_ids_for_sends(&before_fresh_proposal, &fresh_proposal_step, |effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::AuthorityEntry
            )
        })?;
    assert_eq!(authority_entry_packet_ids.len(), 1);
    let authority_entry_packet_id = authority_entry_packet_ids
        .first()
        .copied()
        .ok_or("authority entry packet id was not retained")?;
    record_step(&mut steps, fresh_proposal_step);

    let before_authority_entry = pair.snapshot()?.network.queued_packet_ids;
    let authority_entry_step = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: authority_entry_packet_id,
        },
    })?;
    assert_eq!(
        authority_entry_step.snapshot.network.dropped_count,
        dropped_after_stale
    );
    assert_exact_material_and_control(&authority_entry_step, seat(GUEST_SEAT))?;
    assert_exact_receipts(&authority_entry_step)?;
    assert_replica_frontier(&authority_entry_step.snapshot, 1, 1, 1)?;
    // Ordered proposal settlement is interaction-only; this TurnCommit lease remains retained.
    assert!(
        authority_entry_step
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&original_proposal.operation_id)
    );
    let receipt_packet_ids =
        packet_ids_for_sends(&before_authority_entry, &authority_entry_step, |effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::AuthorityReceipt
            )
        })?;
    assert_eq!(receipt_packet_ids.len(), 3);
    record_step(&mut steps, authority_entry_step);

    for (index, receipt_packet_id) in receipt_packet_ids.into_iter().enumerate() {
        let receipt_step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver {
                packet_id: receipt_packet_id,
            },
        })?;
        assert_eq!(terminal_effect_count(&receipt_step), 0);
        assert_eq!(
            receipt_step.snapshot.network.dropped_count,
            dropped_after_stale
        );
        assert_snapshot_bindings(&receipt_step.snapshot, RECONNECTED_GENERATION)?;
        assert_replica_frontier(&receipt_step.snapshot, 1, 1, 1)?;
        if index < 2 {
            assert!(
                receipt_step
                    .snapshot
                    .host
                    .live_resources
                    .retained_revisions
                    .contains(&Revision::new(safe(1)))
            );
            assert!(
                !receipt_step
                    .snapshot
                    .host
                    .live_resources
                    .delivery_leases
                    .is_empty()
            );
        } else {
            assert!(
                receipt_step
                    .snapshot
                    .host
                    .live_resources
                    .retained_revisions
                    .is_empty()
            );
            assert!(
                receipt_step
                    .snapshot
                    .host
                    .live_resources
                    .delivery_leases
                    .is_empty()
            );
        }
        record_step(&mut steps, receipt_step);
    }

    let accepted = pair.snapshot()?;
    assert_replica_frontier(&accepted, 1, 1, 1)?;
    assert_authority_head_revision(&accepted, 1)?;
    let successor_wait = format!("await/{OPERATION_ID}");
    for endpoint in [&accepted.host, &accepted.guest] {
        assert_eq!(endpoint.ui.kind, UiViewKind::Waiting);
        assert!(!endpoint.ui.actionable);
        assert!(endpoint.live_resources.controls.is_empty());
        assert_eq!(
            endpoint.live_resources.waits,
            BTreeSet::from([successor_wait.clone()])
        );
    }
    assert_snapshot_bindings(&accepted, RECONNECTED_GENERATION)?;

    let final_snapshot = pair.teardown("m2b-08 reconnect campaign complete")?;
    assert_zero_resources(&final_snapshot);
    assert_post_disposal_rejected(&mut pair);
    Ok((steps, final_snapshot))
}

#[test]
fn raw_reconnect_accepts_current_generation_and_drops_stale_traffic_deterministically() -> TestResult
{
    let first = run_reconnect_campaign(0x0bad_cafe)?;
    let second = run_reconnect_campaign(0x0bad_cafe)?;
    assert_eq!(first, second);
    Ok(())
}

#[test]
fn raw_absolute_proposal_ceiling_enters_symmetric_terminal_once() -> TestResult {
    let (mut pair, mut steps, proposal) = initial_protocol_pair(0x1234_5678)?;
    delay_all_queued(&mut pair, &mut steps, safe(2_000_000))?;

    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(
        disconnect_step
            .snapshot
            .network
            .disconnected_endpoints
            .contains(&seat(GUEST_SEAT))
    );
    record_step(&mut steps, disconnect_step);

    let before_ceiling = pair.advance_time(safe(ABSOLUTE_PROPOSAL_CEILING_MS - 1))?;
    assert_eq!(terminal_effect_count(&before_ceiling), 0);
    assert!(before_ceiling.snapshot.terminal_reason.is_none());
    assert!(
        before_ceiling
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&proposal.operation_id)
    );
    record_step(&mut steps, before_ceiling);

    let terminal_step = pair.advance_time(safe(1))?;
    assert_eq!(
        terminal_step.snapshot.virtual_time_ms,
        safe(ABSOLUTE_PROPOSAL_CEILING_MS)
    );
    assert_eq!(terminal_effect_count(&terminal_step), 1);
    assert_eq!(
        terminal_step.snapshot.terminal_reason.as_deref(),
        Some(EXPECTED_ABSOLUTE_TERMINAL_REASON)
    );
    assert_eq!(terminal_step.snapshot.host.ui.kind, UiViewKind::Terminal);
    assert_eq!(terminal_step.snapshot.guest.ui.kind, UiViewKind::Terminal);
    assert_eq!(
        terminal_step.snapshot.host.ui,
        terminal_step.snapshot.guest.ui
    );
    assert_eq!(
        terminal_step.snapshot.host.kernel.ui,
        terminal_step.snapshot.guest.kernel.ui
    );
    assert!(!terminal_step.snapshot.host.ui.actionable);
    assert!(!terminal_step.snapshot.guest.ui.actionable);
    assert_eq!(terminal_step.snapshot.host.ui.owner_seat, None);
    assert_eq!(terminal_step.snapshot.guest.ui.owner_seat, None);
    assert_eq!(
        terminal_step.snapshot.host.ui.prompt_key.as_deref(),
        Some(EXPECTED_ABSOLUTE_TERMINAL_REASON)
    );
    assert!(
        !terminal_step
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&proposal.operation_id)
    );
    let terminal_snapshot = terminal_step.snapshot.clone();
    let terminal_reason = terminal_step.snapshot.terminal_reason.clone();
    record_step(&mut steps, terminal_step);

    let repeated_timer_step = pair.advance_time(SafeU53::ZERO)?;
    assert_eq!(terminal_effect_count(&repeated_timer_step), 0);
    assert_absorbed_snapshot_unchanged(&terminal_snapshot, &repeated_timer_step.snapshot);
    record_step(&mut steps, repeated_timer_step);

    let rejected_input_steps = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert!(!rejected_input_steps.is_empty());
    assert!(
        rejected_input_steps
            .iter()
            .all(|step| step.generated_effects.is_empty())
    );
    for step in &rejected_input_steps {
        assert_absorbed_snapshot_unchanged(&terminal_snapshot, &step.snapshot);
    }
    record_steps(&mut steps, rejected_input_steps);
    assert_eq!(steps.iter().map(terminal_effect_count).sum::<usize>(), 1);

    let final_snapshot = pair.teardown("m2b-08 terminal campaign complete")?;
    assert_zero_resources(&final_snapshot);
    assert_eq!(final_snapshot.terminal_reason, terminal_reason);
    assert_post_disposal_rejected(&mut pair);
    Ok(())
}
