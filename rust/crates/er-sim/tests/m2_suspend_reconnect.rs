use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, MenuProposalPlan,
    ProtocolKernelConfig, ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryDraft, AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding,
    ProposalLeaseConfig, RecoveryTransactionConfig,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairStep, PresenterMode, SimulatedPair,
    SimulatedPairConfig,
};
use er_types::{
    AuthorityEntryKind, CancelPolicy, CommandMenu, ConnectionGeneration, FrameContext, GameButton,
    InputMap, KernelEffect, KeyBinding, Material, MembershipRevision, MenuGeneration,
    MenuOption, MenuOptionId, MenuState, NextControl, PhysicalKey, ProposalMessage, RunId,
    SafeU53, SeatId, SessionId, TerminalControl, TimeClass, UiState, UiViewKind, WaitingMenu,
};
use serde_json::json;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const HOST_SEAT: u64 = 1;
const GUEST_SEAT: u64 = 2;
const INITIAL_GENERATION: u64 = 0;
const RECONNECTED_GENERATION: u64 = 1;
const OPERATION_ID: &str = "m2b-08/reconnect";
const CONTROL_ID: &str = "m2b-08/control";
const OPTION_ID: &str = "m2b-08/accept";
const PROPOSAL_FINGERPRINT: &str = "m2b-08-fingerprint";
const TERMINAL_ID: &str = "m2b-08/absolute-terminal";
const ABSOLUTE_PROPOSAL_CEILING_MS: u64 = 1_200_000;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("campaign value must fit the JavaScript-safe integer domain")
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
        control_id: CONTROL_ID.to_owned(),
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
        request_timeout_ms: safe(300_000),
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
        fingerprint: PROPOSAL_FINGERPRINT.to_owned(),
        draft: AuthorityEntryDraft {
            context: authority_context()?,
            operation_id: operation_id()?,
            kind: AuthorityEntryKind::TurnCommit,
            material: Material {
                digest: "digest-m2b-08".to_owned(),
                payload: json!({
                    "campaign": "m2b-08",
                    "accepted": true
                }),
            },
            next_control: NextControl::Terminal(TerminalControl {
                terminal_id: TERMINAL_ID.to_owned(),
            }),
            subsumes: Vec::new(),
        },
    })
}

fn menu_plan() -> TestResult<ControlMenuPlan> {
    Ok(ControlMenuPlan::Command {
        control_id: CONTROL_ID.to_owned(),
        owner_seat_id: seat(GUEST_SEAT),
        operation_id: operation_id()?,
        field_index: SafeU53::ZERO,
        options: command_options()?,
        proposals: vec![MenuProposalPlan {
            option_id: MenuOptionId::new(OPTION_ID)?,
            fingerprint: PROPOSAL_FINGERPRINT.to_owned(),
            payload: json!({
                "campaign": "m2b-08",
                "option": OPTION_ID
            }),
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
            step.sequence.get(),
            previous
                .sequence
                .get()
                .checked_add(1)
                .expect("campaign sequence must not overflow")
        );
        assert!(
            step.snapshot.virtual_time_ms >= previous.snapshot.virtual_time_ms,
            "virtual time must be monotonic"
        );
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

fn latest_proposal(steps: &[PairStep]) -> Option<ProposalMessage> {
    steps.iter().rev().find_map(|step| proposals_in(step).into_iter().next())
}

fn has_terminal_effect(step: &PairStep) -> bool {
    step.generated_effects
        .iter()
        .any(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
}

fn terminal_effect_count(step: &PairStep) -> usize {
    step.generated_effects
        .iter()
        .filter(|effect| matches!(effect, KernelEffect::EnterSharedTerminal { .. }))
        .count()
}

fn has_timer_class(step: &PairStep, time_class: TimeClass) -> bool {
    step.generated_effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ScheduleTimer {
                time_class: effect_class,
                ..
            } if *effect_class == time_class
        )
    })
}

fn timer_ids_for_class(step: &PairStep, time_class: TimeClass) -> BTreeSet<er_types::TimerId> {
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

fn assert_zero_resources(snapshot: &er_sim::PairSnapshot) {
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
    }
    assert!(snapshot.network.queued_packet_ids.is_empty());
    assert!(snapshot.presenter.pending_event_ids.is_empty());
    assert!(snapshot.storage.pending_request_ids.is_empty());
}

fn new_protocol_pair(seed: u64) -> TestResult<SimulatedPair> {
    let pair = SimulatedPair::new(pair_config(seed)?)?;
    let initial = pair.snapshot()?;
    assert_eq!(initial.seed, seed.to_string());
    assert_eq!(initial.virtual_time_ms, SafeU53::ZERO);
    assert_eq!(initial.host.ui.kind, UiViewKind::Waiting);
    assert_eq!(initial.guest.ui.kind, UiViewKind::Command);
    Ok(pair)
}

fn submit_proposal(
    pair: &mut SimulatedPair,
    steps: &mut Vec<PairStep>,
) -> TestResult<ProposalMessage> {
    record_steps(
        steps,
        pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?,
    );
    let proposal = latest_proposal(steps).expect("raw command input must admit a proposal");
    let submission = steps
        .iter()
        .rev()
        .find(|step| !proposals_in(step).is_empty())
        .expect("proposal effect must have a snapshot");
    assert_eq!(proposal.from, seat(GUEST_SEAT));
    assert_eq!(proposal.to, seat(HOST_SEAT));
    assert_eq!(proposal.operation_id.as_str(), OPERATION_ID);
    assert_eq!(proposal.fingerprint, PROPOSAL_FINGERPRINT);
    assert_eq!(
        proposal.connection_generation,
        generation(INITIAL_GENERATION)
    );
    assert!(
        submission
            .snapshot
            .guest
            .live_resources
            .proposal_leases
            .contains(&proposal.operation_id)
    );
    assert!(has_timer_class(submission, TimeClass::Connected));
    assert!(has_timer_class(submission, TimeClass::Absolute));
    assert!(!submission.snapshot.network.queued_packet_ids.is_empty());
    Ok(proposal)
}

fn initial_protocol_pair(seed: u64) -> TestResult<(SimulatedPair, Vec<PairStep>, ProposalMessage)> {
    let mut pair = new_protocol_pair(seed)?;
    let mut steps = Vec::new();
    let proposal = submit_proposal(&mut pair, &mut steps)?;
    Ok((pair, steps, proposal))
}

#[test]
fn raw_suspend_resume_pauses_mechanical_timers_while_absolute_time_advances() -> TestResult {
    let mut pair = new_protocol_pair(0x0123_4567_89ab_cdef)?;
    let mut steps = Vec::new();

    let key_down = pair.key_down(PairEndpoint::Guest, PhysicalKey::ArrowDown, false)?;
    assert!(has_timer_class(&key_down, TimeClass::HumanInput));
    let held_timer_ids = timer_ids_for_class(&key_down, TimeClass::HumanInput);
    assert!(!held_timer_ids.is_empty());
    record_step(&mut steps, key_down);

    let proposal = submit_proposal(&mut pair, &mut steps)?;
    let submission = steps
        .iter()
        .rev()
        .find(|step| !proposals_in(step).is_empty())
        .expect("proposal effect must have a snapshot");
    let connected_timer_ids = timer_ids_for_class(submission, TimeClass::Connected);
    let absolute_timer_ids = timer_ids_for_class(submission, TimeClass::Absolute);
    assert!(!connected_timer_ids.is_empty());
    assert!(!absolute_timer_ids.is_empty());
    assert!(held_timer_ids.iter().all(|timer_id| {
        submission
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(timer_id)
    }));

    for packet_id in pair.snapshot()?.network.queued_packet_ids {
        record_step(
            &mut steps,
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::Delay {
                    packet_id,
                    additional_ms: safe(2_000_000),
                },
            })?,
        );
    }

    let suspend_step = pair.apply(PairOperation::Suspend {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(suspend_step
        .snapshot
        .network
        .suspended_endpoints
        .contains(&seat(GUEST_SEAT)));
    record_step(&mut steps, suspend_step);

    let suspended_advance = pair.advance_time(safe(60_000))?;
    assert_eq!(
        suspended_advance.snapshot.virtual_time_ms,
        safe(60_000)
    );
    assert!(
        held_timer_ids
            .iter()
            .all(|timer_id| suspended_advance
                .snapshot
                .guest
                .live_resources
                .timers
                .contains(timer_id))
    );
    assert!(connected_timer_ids.iter().all(|timer_id| {
        suspended_advance
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(timer_id)
    }));
    assert!(absolute_timer_ids.iter().all(|timer_id| {
        suspended_advance
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(timer_id)
    }));
    assert!(!has_terminal_effect(&suspended_advance));
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
    assert!(!resume_step
        .snapshot
        .network
        .suspended_endpoints
        .contains(&seat(GUEST_SEAT)));
    record_step(&mut steps, resume_step);

    let resumed_advance = pair.advance_time(safe(250))?;
    assert!(
        resumed_advance
            .generated_effects
            .iter()
            .any(|effect| matches!(effect, KernelEffect::UiChanged { .. }))
    );
    assert!(has_timer_class(&resumed_advance, TimeClass::HumanInput));
    assert!(resumed_advance
        .generated_effects
        .iter()
        .any(|effect| matches!(effect, KernelEffect::SendProposal { .. })));
    record_step(&mut steps, resumed_advance);
    record_step(
        &mut steps,
        pair.key_up(PairEndpoint::Guest, PhysicalKey::ArrowDown)?,
    );

    let snapshot = pair.snapshot()?;
    assert_eq!(snapshot.virtual_time_ms, safe(60_250));
    assert!(snapshot.guest.live_resources.proposal_leases.contains(&proposal.operation_id));
    assert!(absolute_timer_ids.iter().all(|timer_id| {
        snapshot.guest.live_resources.timers.contains(timer_id)
    }));
    let final_snapshot = pair.teardown("m2b-08 suspend campaign complete")?;
    assert_zero_resources(&final_snapshot);
    Ok(())
}

#[test]
fn raw_reconnect_rebinds_identity_and_rejects_stale_old_generation_traffic() -> TestResult {
    let (mut pair, mut steps, original_proposal) = initial_protocol_pair(0x0bad_cafe)?;
    let initial_snapshot = pair.snapshot()?;
    let old_packet_ids = initial_snapshot.network.queued_packet_ids.clone();
    assert!(!old_packet_ids.is_empty());

    for packet_id in &old_packet_ids {
        record_step(
            &mut steps,
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::Delay {
                    packet_id: *packet_id,
                    additional_ms: safe(2_000_000),
                },
            })?,
        );
    }

    let before_disconnect = pair.snapshot()?;
    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(disconnect_step
        .snapshot
        .network
        .disconnected_endpoints
        .contains(&seat(GUEST_SEAT)));
    let before_reconnect = disconnect_step.snapshot.clone();
    record_step(&mut steps, disconnect_step);
    let reconnect_step = pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    let rebound = proposals_in(&reconnect_step)
        .into_iter()
        .find(|proposal| proposal.operation_id == original_proposal.operation_id)
        .expect("reconnect must resend the retained proposal");
    assert_eq!(rebound.operation_id, original_proposal.operation_id);
    assert_eq!(rebound.fingerprint, original_proposal.fingerprint);
    assert_eq!(rebound.payload, original_proposal.payload);
    assert_eq!(rebound.from, original_proposal.from);
    assert_eq!(rebound.to, original_proposal.to);
    assert_eq!(
        rebound.connection_generation,
        generation(RECONNECTED_GENERATION)
    );
    assert_eq!(reconnect_step.snapshot.network.disconnected_endpoints, BTreeSet::new());
    record_step(&mut steps, reconnect_step);

    let after_reconnect = pair.snapshot()?;
    let fresh_packet_ids = after_reconnect
        .network
        .queued_packet_ids
        .difference(&old_packet_ids)
        .copied()
        .collect::<Vec<_>>();
    assert!(!fresh_packet_ids.is_empty());

    let stale_packet_ids = after_reconnect
        .network
        .queued_packet_ids
        .intersection(&old_packet_ids)
        .copied()
        .collect::<Vec<_>>();
    if let Some(stale_packet_id) = stale_packet_ids.first().copied() {
        let stale_step = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver {
                packet_id: stale_packet_id,
            },
        })?;
        assert!(!has_terminal_effect(&stale_step));
        assert!(stale_step.snapshot.network.dropped_count > before_reconnect.network.dropped_count);
        assert!(
            stale_step
                .snapshot
                .guest
                .live_resources
                .proposal_leases
                .contains(&original_proposal.operation_id)
        );
        record_step(&mut steps, stale_step);
    } else {
        assert!(after_reconnect.network.dropped_count > before_disconnect.network.dropped_count);
    }

    let final_snapshot = pair.teardown("m2b-08 reconnect campaign complete")?;
    assert_zero_resources(&final_snapshot);
    Ok(())
}

#[test]
fn raw_absolute_proposal_ceiling_enters_symmetric_terminal_once() -> TestResult {
    let (mut pair, mut steps, proposal) = initial_protocol_pair(0x1234_5678)?;
    let initial_packet_ids = pair.snapshot()?.network.queued_packet_ids;
    for packet_id in initial_packet_ids {
        record_step(
            &mut steps,
            pair.apply(PairOperation::Fault {
                operation: FaultOperation::Delay {
                    packet_id,
                    additional_ms: safe(2_000_000),
                },
            })?,
        );
    }

    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert!(disconnect_step
        .snapshot
        .network
        .disconnected_endpoints
        .contains(&seat(GUEST_SEAT)));
    record_step(&mut steps, disconnect_step);
    let terminal_step = pair.advance_time(safe(ABSOLUTE_PROPOSAL_CEILING_MS))?;
    assert_eq!(
        terminal_step.snapshot.virtual_time_ms,
        safe(ABSOLUTE_PROPOSAL_CEILING_MS)
    );
    assert_eq!(terminal_effect_count(&terminal_step), 1);
    assert!(terminal_step.snapshot.terminal_reason.is_some());
    assert_eq!(terminal_step.snapshot.host.ui.kind, UiViewKind::Terminal);
    assert_eq!(terminal_step.snapshot.guest.ui.kind, UiViewKind::Terminal);
    assert!(!terminal_step
        .snapshot
        .guest
        .live_resources
        .proposal_leases
        .contains(&proposal.operation_id));
    record_step(&mut steps, terminal_step);

    let repeated_timer_step = pair.advance_time(SafeU53::ZERO)?;
    assert_eq!(terminal_effect_count(&repeated_timer_step), 0);
    assert_eq!(
        repeated_timer_step.snapshot.terminal_reason,
        steps.last().and_then(|step| step.snapshot.terminal_reason.clone())
    );
    record_step(&mut steps, repeated_timer_step);

    let rejected_input_steps = pair.press(PairEndpoint::Guest, PhysicalKey::Enter)?;
    assert!(rejected_input_steps.iter().all(|step| !has_terminal_effect(step)));
    record_steps(&mut steps, rejected_input_steps);

    let final_snapshot = pair.teardown("m2b-08 terminal campaign complete")?;
    assert_zero_resources(&final_snapshot);
    assert!(final_snapshot.terminal_reason.is_some());
    Ok(())
}
