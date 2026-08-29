use std::collections::BTreeMap;
use std::error::Error;

use serde::de::DeserializeOwned;

use er_kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, KernelConfig, MenuProposalPlan, ProtocolKernelConfig,
    ProtocolRoleConfig,
};
use er_protocol::{
    AuthorityEntryBody, AuthorityEntryDraft, AuthorityLogConfig, BackoffPolicy,
    DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS, DEFAULT_RECOVERY_PACING_MS,
    DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS, PeerBinding, ProposalFingerprintInput, ProposalJson,
    RecoveryAppliedProof, RecoveryBundleBody, RecoveryRequestBody, RecoveryTransactionConfig,
    control_id_of, proposal_fingerprint,
};
use er_sim::{
    FaultOperation, PairEndpoint, PairOperation, PairSnapshot, PairStep, PresenterMode,
    SimulatedPair, SimulatedPairConfig, SimulatedPairError,
};
use er_types::{
    AckStage, AuthorityEntryKind, AuthorityReceiptBody, CancelPolicy, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, FrameContext, FrameType, GameButton, InputFocus,
    InputMap, KernelEffect, KeyBinding, LiveResourceSnapshot, Material, MembershipRevision,
    MenuGeneration, MenuOption, MenuOptionId, MenuState, NetworkFrame, NextControl, OperationId,
    PhysicalKey, ProposalMessage, RawInputEvent, RecoveryFenceState, RecoveryFenceView, Revision,
    RunId, SafeU53, SeatId, SessionId, TimeClass, TimerId, UiIntent, UiState, UiViewKind,
    WaitingMenu,
};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const SEED: u64 = 0x0123_4567_dead_beef;
const HOST_SEAT: u64 = 0;
const GUEST_SEAT: u64 = 1;

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

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn operation(value: u64) -> Result<OperationId, Box<dyn Error>> {
    Ok(OperationId::new(format!("recovery-operation-{value}"))?)
}

fn context(sender_seat_id: u64) -> Result<FrameContext, Box<dyn Error>> {
    context_at(sender_seat_id, 0)
}

fn context_at(
    sender_seat_id: u64,
    connection_generation: u64,
) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m2-recovery-campaign")?,
        run_id: RunId::new("m2-recovery-run")?,
        session_epoch: safe(1),
        seat_map_id: "m2-recovery-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(sender_seat_id),
        authority_seat_id: seat(HOST_SEAT),
        connection_generation: generation(connection_generation),
    })
}

fn input_map() -> InputMap {
    InputMap {
        keyboard: vec![
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

fn command_control(turn: u64, owner_seat_id: u64) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(1),
        turn: safe(turn),
        commands: vec![CommandControlTarget {
            owner_seat_id: seat(owner_seat_id),
            pokemon_id: safe(7),
            field_index: safe(0),
        }],
    })
}

fn next_control(turn: u64) -> NextControl {
    match turn {
        1 => command_control(2, GUEST_SEAT),
        2 => command_control(3, HOST_SEAT),
        3 => command_control(4, GUEST_SEAT),
        4 => command_control(5, HOST_SEAT),
        _ => command_control(turn + 1, HOST_SEAT),
    }
}

fn option(turn: u64) -> Result<MenuOption, Box<dyn Error>> {
    let option_id = MenuOptionId::new(format!("action-{turn}"))?;
    Ok(MenuOption {
        id: option_id,
        label_key: format!("recovery.action.{turn}"),
        enabled: true,
        visible: true,
    })
}

fn directional_option(turn: u64) -> Result<MenuOption, Box<dyn Error>> {
    let option_id = MenuOptionId::new(format!("action-{turn}-directional"))?;
    Ok(MenuOption {
        id: option_id,
        label_key: format!("recovery.action.{turn}.directional"),
        enabled: true,
        visible: true,
    })
}

fn repeat_probe_option(index: u64) -> Result<MenuOption, Box<dyn Error>> {
    Ok(MenuOption {
        id: MenuOptionId::new(format!("repeat-probe-{index}"))?,
        label_key: format!("repeat.probe.{index}"),
        enabled: true,
        visible: true,
    })
}

fn repeat_probe_menu() -> Result<MenuState, Box<dyn Error>> {
    Ok(MenuState::Command(er_types::CommandMenu {
        operation_id: OperationId::new("repeat-probe-operation")?,
        control_id: "repeat-probe-control".to_owned(),
        cursor: SafeU53::ZERO,
        options: (0..3)
            .map(repeat_probe_option)
            .collect::<Result<Vec<_>, _>>()?,
        cancel: CancelPolicy::Disabled,
    }))
}

fn proposal_payload(turn: u64) -> Value {
    json!({
        "surface": "m2-recovery-campaign",
        "turn": turn,
    })
}

fn production_proposal_fingerprint(turn: u64) -> Result<String, Box<dyn Error>> {
    let wire = ProposalJson::new(serde_json::to_string(&proposal_payload(turn))?)?;
    Ok(proposal_fingerprint(&ProposalFingerprintInput::Ordinary {
        sequence: safe(turn),
        label: format!("recovery.action.{turn}"),
        choice: er_types::SafeI53::ZERO,
        wire: Some(wire),
        reward_surface: None,
    })?)
}

fn material(turn: u64) -> Material {
    Material {
        digest: format!("recovery-material-{turn}"),
        payload: json!({
            "epoch": 1,
            "wave": 1,
            "turn": turn,
            "material": "full-entry",
        }),
    }
}

fn command_menu(turn: u64, owner_seat_id: u64) -> Result<MenuState, Box<dyn Error>> {
    let control = command_control(turn, owner_seat_id);
    Ok(MenuState::Command(er_types::CommandMenu {
        operation_id: operation(turn)?,
        control_id: control_id_of(&control),
        cursor: safe(0),
        options: vec![option(turn)?, directional_option(turn)?],
        cancel: CancelPolicy::Disabled,
    }))
}

fn command_plan(turn: u64, owner_seat_id: u64) -> Result<ControlMenuPlan, Box<dyn Error>> {
    let option = option(turn)?;
    let control = command_control(turn, owner_seat_id);
    Ok(ControlMenuPlan::Command {
        control_id: control_id_of(&control),
        owner_seat_id: seat(owner_seat_id),
        operation_id: operation(turn)?,
        field_index: safe(0),
        options: vec![option.clone(), directional_option(turn)?],
        proposals: vec![MenuProposalPlan {
            option_id: option.id,
            fingerprint: production_proposal_fingerprint(turn)?,
            payload: proposal_payload(turn),
        }],
        cancel: CancelPolicy::Disabled,
    })
}

fn resolution_plan(
    authority_context: &FrameContext,
    turn: u64,
) -> Result<AuthorityResolutionPlan, Box<dyn Error>> {
    let operation_id = operation(turn)?;
    Ok(AuthorityResolutionPlan {
        operation_id: operation_id.clone(),
        fingerprint: production_proposal_fingerprint(turn)?,
        draft: AuthorityEntryDraft {
            context: authority_context.clone(),
            operation_id,
            kind: AuthorityEntryKind::TurnCommit,
            material: material(turn),
            next_control: next_control(turn),
            subsumes: Vec::new(),
        },
    })
}

fn protocol_configs() -> Result<(ProtocolKernelConfig, ProtocolKernelConfig), Box<dyn Error>> {
    let authority_context = context(HOST_SEAT)?;
    let replica_context = context(GUEST_SEAT)?;
    let menu_plans = vec![
        command_plan(1, HOST_SEAT)?,
        command_plan(2, GUEST_SEAT)?,
        command_plan(3, HOST_SEAT)?,
        command_plan(4, GUEST_SEAT)?,
        command_plan(5, HOST_SEAT)?,
    ];
    let resolutions = (1..=4)
        .map(|turn| resolution_plan(&authority_context, turn))
        .collect::<Result<Vec<_>, _>>()?;

    let authority = ProtocolKernelConfig {
        role: ProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: authority_context,
                peer_bindings: vec![PeerBinding {
                    seat_id: seat(GUEST_SEAT),
                    connection_generation: generation(0),
                }],
                owner_id: "m2-recovery-campaign-authority".to_owned(),
                retain_capacity: safe(16),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: er_types::TimeClass::Connected,
                max_delivery_attempts: Some(safe(1)),
            },
            proposal_capacity: safe(8_192),
            resolutions,
        },
        menu_plans: menu_plans.clone(),
    };

    let replica = ProtocolKernelConfig {
        role: ProtocolRoleConfig::Replica {
            replica: er_protocol::AuthorityReplicaConfig {
                receipt_context: replica_context.clone(),
                authority_seat_id: seat(HOST_SEAT),
                authority_connection_generation: generation(0),
            },
            proposal_leases: er_protocol::ProposalLeaseConfig {
                owner_prefix: "m2-recovery-campaign-proposal".to_owned(),
                retry_initial_ms: safe(250),
                retry_maximum_ms: safe(5_000),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: replica_context,
                request_timeout_ms: safe(DEFAULT_RECOVERY_REQUEST_TIMEOUT_MS),
                control_timeout_ms: safe(DEFAULT_RECOVERY_CONTROL_TIMEOUT_MS),
                pacing_ms: safe(DEFAULT_RECOVERY_PACING_MS),
                timer_owner_id: "m2-recovery-campaign-recovery".to_owned(),
            },
        },
        menu_plans,
    };

    Ok((authority, replica))
}

fn campaign_config() -> Result<SimulatedPairConfig, Box<dyn Error>> {
    let (authority, replica) = protocol_configs()?;
    Ok(SimulatedPairConfig {
        host_kernel: KernelConfig {
            input_map: input_map(),
            initial_ui: UiState {
                generation: MenuGeneration::new(safe(1)),
                owner_seat: Some(seat(HOST_SEAT)),
                actionable: true,
                stack: vec![command_menu(1, HOST_SEAT)?],
            },
            protocol: Some(authority),
        },
        guest_kernel: KernelConfig {
            input_map: input_map(),
            initial_ui: UiState {
                generation: MenuGeneration::new(safe(1)),
                owner_seat: None,
                actionable: false,
                stack: vec![MenuState::Waiting(WaitingMenu {
                    prompt_key: Some("recovery.waiting".to_owned()),
                })],
            },
            protocol: Some(replica),
        },
        host_seat: seat(HOST_SEAT),
        guest_seat: seat(GUEST_SEAT),
        seed: SEED,
        presenter: PresenterMode::Instant,
        initial_storage: BTreeMap::from([(
            "m2-recovery-campaign".to_owned(),
            json!({"seed": SEED.to_string(), "purpose": "teardown evidence"}),
        )]),
        event_budget: safe(10_000),
    })
}

fn repeat_probe_config() -> Result<SimulatedPairConfig, Box<dyn Error>> {
    Ok(SimulatedPairConfig {
        host_kernel: KernelConfig {
            input_map: input_map(),
            initial_ui: UiState {
                generation: MenuGeneration::new(safe(1)),
                owner_seat: None,
                actionable: false,
                stack: vec![MenuState::Waiting(WaitingMenu {
                    prompt_key: Some("repeat.probe.waiting".to_owned()),
                })],
            },
            protocol: None,
        },
        guest_kernel: KernelConfig {
            input_map: input_map(),
            initial_ui: UiState {
                generation: MenuGeneration::new(safe(1)),
                owner_seat: Some(seat(GUEST_SEAT)),
                actionable: true,
                stack: vec![repeat_probe_menu()?],
            },
            protocol: None,
        },
        host_seat: seat(HOST_SEAT),
        guest_seat: seat(GUEST_SEAT),
        seed: SEED ^ 0x250,
        presenter: PresenterMode::Instant,
        initial_storage: BTreeMap::new(),
        event_budget: safe(256),
    })
}

fn drop_queued_packets(pair: &mut SimulatedPair, trace: &mut Vec<PairStep>) -> TestResult {
    let Some(last) = trace.last() else {
        return Err(std::io::Error::other("cannot drop packets without a campaign step").into());
    };
    let packet_ids = last
        .snapshot
        .network
        .queued_packet_ids
        .iter()
        .copied()
        .collect::<Vec<_>>();
    for packet_id in packet_ids {
        trace.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::Drop { packet_id },
        })?);
    }
    Ok(())
}

fn hold_new_packets_after_guest_action(
    pair: &mut SimulatedPair,
    trace: &mut Vec<PairStep>,
) -> TestResult<(ProposalMessage, SafeU53)> {
    let action_start = trace.len();
    let previous_packet_ids = trace
        .last()
        .map(|step| step.snapshot.network.queued_packet_ids.clone())
        .ok_or_else(|| std::io::Error::other("guest action has no preceding campaign step"))?;
    trace.push(pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?);
    trace.push(pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
    })?);
    let proposals = proposal_effects(&trace[action_start..]);
    assert_eq!(
        proposals.len(),
        1,
        "guest action must retain one proposal lease"
    );
    let retained_proposal = proposals[0].clone();
    assert_eq!(retained_proposal.from, seat(GUEST_SEAT));

    let proposal_packet_id = trace
        .last()
        .ok_or_else(|| std::io::Error::other("guest action did not produce a packet step"))?
        .snapshot
        .network
        .queued_packet_ids
        .difference(&previous_packet_ids)
        .copied()
        .collect::<Vec<_>>();
    assert_eq!(
        proposal_packet_id.len(),
        1,
        "guest proposal must be the only newly queued packet"
    );
    let proposal_packet_id = proposal_packet_id[0];
    let duplicate_step = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Duplicate {
            packet_id: proposal_packet_id,
        },
    })?;
    let duplicate_packet_ids = duplicate_step
        .snapshot
        .network
        .queued_packet_ids
        .difference(
            &trace
                .last()
                .ok_or_else(|| std::io::Error::other("proposal duplicate has no prior step"))?
                .snapshot
                .network
                .queued_packet_ids,
        )
        .copied()
        .collect::<Vec<_>>();
    assert_eq!(
        duplicate_packet_ids.len(),
        1,
        "proposal duplication must add exactly one packet"
    );
    let stale_packet_id = duplicate_packet_ids[0];
    trace.push(duplicate_step);
    trace.push(pair.apply(PairOperation::Fault {
        operation: FaultOperation::Delay {
            packet_id: stale_packet_id,
            additional_ms: safe(1_000),
        },
    })?);
    let mut previous = trace
        .last()
        .map(|step| step.snapshot.network.queued_packet_ids.clone())
        .ok_or_else(|| std::io::Error::other("guest action did not produce a campaign step"))?;

    for _ in 0..12 {
        let step = pair.advance_time(safe(1))?;
        let current = step.snapshot.network.queued_packet_ids.clone();
        let added = current.difference(&previous).copied().collect::<Vec<_>>();
        let removed = previous.difference(&current).next().is_some();
        trace.push(step);

        if removed && !added.is_empty() {
            for packet_id in added {
                trace.push(pair.apply(PairOperation::Fault {
                    operation: FaultOperation::Delay {
                        packet_id,
                        additional_ms: safe(1_000),
                    },
                })?);
            }
            return Ok((retained_proposal, stale_packet_id));
        }
        previous = trace
            .last()
            .map(|step| step.snapshot.network.queued_packet_ids.clone())
            .ok_or_else(|| std::io::Error::other("campaign lost its packet snapshot"))?;
    }

    Err(std::io::Error::other(
        "guest proposal did not reach the authority within the deterministic window",
    )
    .into())
}

fn effects(steps: &[PairStep]) -> Vec<KernelEffect> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter().cloned())
        .collect()
}

fn has_frame(effects: &[KernelEffect], frame_type: FrameType) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::SendFrame { frame, .. } if frame.frame_type == frame_type
        )
    })
}

fn frame_effects(effects: &[KernelEffect], frame_type: FrameType) -> Vec<(SeatId, &NetworkFrame)> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::SendFrame { from, frame } if frame.frame_type == frame_type => {
                Some((*from, frame))
            }
            _ => None,
        })
        .collect()
}

fn send_effect_packets(
    before: &PairSnapshot,
    step: &PairStep,
) -> TestResult<Vec<(SafeU53, KernelEffect)>> {
    let queued_packet_ids = step
        .snapshot
        .network
        .queued_packet_ids
        .difference(&before.network.queued_packet_ids)
        .copied()
        .collect::<Vec<_>>();
    let send_effects = step
        .generated_effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { .. } | KernelEffect::SendProposal { .. }
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(
        queued_packet_ids.len(),
        send_effects.len(),
        "every connected send effect must produce one newly queued packet"
    );

    let packets = queued_packet_ids
        .into_iter()
        .zip(send_effects)
        .collect::<Vec<_>>();
    Ok(packets)
}

fn is_control_installed_receipt(effect: &KernelEffect) -> bool {
    let KernelEffect::SendFrame { frame, .. } = effect else {
        return false;
    };
    if frame.frame_type != FrameType::AuthorityReceipt {
        return false;
    }
    serde_json::from_value::<AuthorityReceiptBody>(frame.body.clone())
        .map(|receipt| receipt.stage == AckStage::ControlInstalled)
        .unwrap_or(false)
}

fn typed_frame_body<T: DeserializeOwned>(frame: &NetworkFrame) -> TestResult<T> {
    Ok(serde_json::from_value(frame.body.clone())?)
}

fn typed_json_path<T: DeserializeOwned>(root: &Value, path: &[&str]) -> TestResult<T> {
    let path_label = path.join(".");
    let mut value = root;
    for segment in path {
        value = value
            .as_object()
            .and_then(|object| object.get(*segment))
            .ok_or_else(|| {
                std::io::Error::other(format!(
                    "kernel snapshot is missing exact JSON path {path_label}"
                ))
            })?;
    }
    Ok(serde_json::from_value(value.clone()).map_err(|error| {
        std::io::Error::other(format!(
            "kernel snapshot JSON path {path_label} has the wrong type: {error}"
        ))
    })?)
}

fn guest_recovery_fence(step: &PairStep) -> TestResult<RecoveryFenceView> {
    typed_json_path(
        &step.snapshot.guest.kernel.state,
        &["protocol", "recoveryFence"],
    )
}

fn assert_held_recovery_fence(view: &RecoveryFenceView) {
    assert_eq!(view.state, RecoveryFenceState::Held);
    assert!(view.command_admission_frozen);
    assert!(view.control_surface_start_frozen);
    assert!(view.progression_frozen);
    assert!(view.materialization_frozen);
    assert!(view.authority_wait_creation_frozen);
    assert_eq!(view.terminal_reason, None);
}

fn assert_open_recovery_fence(view: &RecoveryFenceView) {
    assert_eq!(view.state, RecoveryFenceState::Open);
    assert!(!view.command_admission_frozen);
    assert!(!view.control_surface_start_frozen);
    assert!(!view.progression_frozen);
    assert!(!view.materialization_frozen);
    assert!(!view.authority_wait_creation_frozen);
    assert_eq!(view.terminal_reason, None);
}

fn expected_tail_entry(expected_revision: u64) -> TestResult<AuthorityEntryBody> {
    Ok(AuthorityEntryBody {
        revision: revision(expected_revision),
        operation_id: operation(expected_revision)?,
        kind: AuthorityEntryKind::TurnCommit,
        material: material(expected_revision),
        next_control: next_control(expected_revision),
        subsumes: Vec::new(),
    })
}

fn assert_full_tail_entry(entry: &AuthorityEntryBody, expected_revision: u64) -> TestResult {
    let expected = expected_tail_entry(expected_revision)?;
    assert_eq!(entry, &expected, "recovery tail entry identity drifted");
    assert_eq!(
        entry.material.digest,
        format!("recovery-material-{expected_revision}")
    );
    assert_eq!(entry.material.payload, material(expected_revision).payload);
    assert_eq!(
        control_id_of(&entry.next_control),
        control_id_of(&expected.next_control)
    );
    Ok(())
}

fn proposal_effects(steps: &[PairStep]) -> Vec<&ProposalMessage> {
    steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::SendProposal { proposal } => Some(proposal),
            _ => None,
        })
        .collect()
}

fn assert_proposal_identities(
    steps: &[PairStep],
    expected: &[(u64, ConnectionGeneration)],
) -> TestResult {
    let proposals = proposal_effects(steps);
    assert_eq!(proposals.len(), expected.len());
    for (proposal, (turn, expected_generation)) in
        proposals.into_iter().zip(expected.iter().copied())
    {
        assert_eq!(proposal.operation_id, operation(turn)?);
        assert_eq!(proposal.fingerprint, production_proposal_fingerprint(turn)?);
        assert_eq!(proposal.from, seat(GUEST_SEAT));
        assert_eq!(proposal.to, seat(HOST_SEAT));
        assert_eq!(proposal.connection_generation, expected_generation);
        assert_eq!(proposal.payload, proposal_payload(turn));
    }
    Ok(())
}

fn has_guest_stale_effect(
    effects: &[KernelEffect],
    current_connection_generation: ConnectionGeneration,
) -> bool {
    effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiIntent { endpoint, .. } if *endpoint == seat(GUEST_SEAT)
        ) || matches!(
            effect,
            KernelEffect::SendProposal { proposal }
                if proposal.from == seat(GUEST_SEAT)
                    && proposal.connection_generation != current_connection_generation
        )
    })
}

fn assert_no_pair_progression(before: &PairSnapshot, after: &PairSnapshot) -> TestResult {
    assert_eq!(before.host.kernel, after.host.kernel);
    assert_eq!(before.guest.kernel, after.guest.kernel);
    assert_eq!(before.host.ui, after.host.ui);
    assert_eq!(before.guest.ui, after.guest.ui);
    assert_eq!(before.host.live_resources, after.host.live_resources);
    assert_eq!(before.guest.live_resources, after.guest.live_resources);
    assert_eq!(
        before.host.live_resources.retained_revisions,
        after.host.live_resources.retained_revisions
    );
    assert_eq!(
        before.guest.live_resources.proposal_leases,
        after.guest.live_resources.proposal_leases
    );
    assert_eq!(
        before.guest.live_resources.controls,
        after.guest.live_resources.controls
    );
    assert_eq!(
        before.network.queued_packet_ids,
        after.network.queued_packet_ids
    );
    Ok(())
}

fn assert_no_protocol_progression(before: &PairSnapshot, after: &PairSnapshot) -> TestResult {
    assert_eq!(before.host.kernel, after.host.kernel);
    assert_eq!(before.guest.kernel, after.guest.kernel);
    assert_eq!(before.host.ui, after.host.ui);
    assert_eq!(before.guest.ui, after.guest.ui);
    assert_eq!(before.host.live_resources, after.host.live_resources);
    assert_eq!(before.guest.live_resources, after.guest.live_resources);
    assert_eq!(
        before.host.live_resources.retained_revisions,
        after.host.live_resources.retained_revisions
    );
    assert_eq!(
        before.guest.live_resources.proposal_leases,
        after.guest.live_resources.proposal_leases
    );
    assert_eq!(
        before.guest.live_resources.controls,
        after.guest.live_resources.controls
    );
    Ok(())
}

fn assert_duplicate_delivery_is_idempotent(
    before: &PairSnapshot,
    step: &PairStep,
    delivered_packet_id: SafeU53,
) -> TestResult {
    let mut receipt_count = 0_usize;
    for effect in &step.generated_effects {
        let KernelEffect::SendFrame { from, frame } = effect else {
            return Err(std::io::Error::other(format!(
                "duplicate retry delivery emitted a forbidden effect: {effect:?}"
            ))
            .into());
        };
        assert_eq!(*from, seat(HOST_SEAT));
        assert_eq!(frame.frame_type, FrameType::AuthorityReceipt);
        assert_eq!(frame.context.sender_seat_id, seat(HOST_SEAT));
        let receipt: AuthorityReceiptBody = typed_frame_body(frame)?;
        assert_eq!(receipt.revision, revision(4));
        assert_eq!(receipt.operation_id, operation(4)?);
        assert_eq!(receipt.stage, AckStage::ControlInstalled);
        assert_eq!(receipt.control_id, Some(control_id_of(&next_control(4))));
        receipt_count += 1;
    }

    assert_no_protocol_progression(before, &step.snapshot)?;
    assert_eq!(before.virtual_time_ms, step.snapshot.virtual_time_ms);
    assert_eq!(before.clock_timers, step.snapshot.clock_timers);
    assert_eq!(before.host.state_digest, step.snapshot.host.state_digest);
    assert_eq!(before.guest.state_digest, step.snapshot.guest.state_digest);
    assert_eq!(before.host.presenter, step.snapshot.host.presenter);
    assert_eq!(before.guest.presenter, step.snapshot.guest.presenter);
    assert_eq!(before.presenter, step.snapshot.presenter);
    assert_eq!(before.storage, step.snapshot.storage);
    assert_eq!(
        before.network.disconnected_endpoints,
        step.snapshot.network.disconnected_endpoints
    );
    assert_eq!(
        before.network.suspended_endpoints,
        step.snapshot.network.suspended_endpoints
    );
    assert_eq!(
        before.network.dropped_count,
        step.snapshot.network.dropped_count
    );
    assert_eq!(
        before.network.duplicated_count,
        step.snapshot.network.duplicated_count
    );
    assert_eq!(
        before.network.corrupted_count,
        step.snapshot.network.corrupted_count
    );
    assert_eq!(before.network.disposed, step.snapshot.network.disposed);

    let mut expected_packet_ids = before.network.queued_packet_ids.clone();
    assert!(expected_packet_ids.remove(&delivered_packet_id));
    let added_packet_ids = step
        .snapshot
        .network
        .queued_packet_ids
        .difference(&before.network.queued_packet_ids)
        .count();
    assert_eq!(added_packet_ids, receipt_count);
    expected_packet_ids.extend(
        step.snapshot
            .network
            .queued_packet_ids
            .difference(&before.network.queued_packet_ids)
            .copied(),
    );
    assert_eq!(
        step.snapshot.network.queued_packet_ids, expected_packet_ids,
        "duplicate delivery may remove its packet and add only receipt packets"
    );
    Ok(())
}

fn guest_human_input_schedules(step: &PairStep, delay_ms: SafeU53) -> Vec<TimerId> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                endpoint,
                timer_id,
                delay_ms: scheduled_delay,
                time_class,
                ..
            } if *endpoint == seat(GUEST_SEAT)
                && *scheduled_delay == delay_ms
                && *time_class == TimeClass::HumanInput =>
            {
                Some(*timer_id)
            }
            _ => None,
        })
        .collect()
}

fn guest_timer_cancellations(step: &PairStep) -> Vec<TimerId> {
    step.generated_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::CancelTimer { endpoint, timer_id } if *endpoint == seat(GUEST_SEAT) => {
                Some(*timer_id)
            }
            _ => None,
        })
        .collect()
}

fn assert_directional_hold_started(before: &PairSnapshot, step: &PairStep) -> TestResult {
    assert_eq!(before.guest.ui.kind, UiViewKind::Command);
    assert_eq!(before.guest.ui.owner_seat, Some(seat(GUEST_SEAT)));
    assert!(before.guest.ui.actionable);
    assert_eq!(before.guest.ui.cursor, Some(safe(0)));
    assert!(
        before
            .guest
            .ui
            .options
            .iter()
            .filter(|option| option.enabled && option.visible)
            .count()
            >= 2
    );
    let enabled_visible = step
        .snapshot
        .guest
        .ui
        .options
        .iter()
        .filter(|option| option.enabled && option.visible)
        .count();
    assert!(enabled_visible >= 2);
    assert_eq!(step.snapshot.guest.ui.kind, UiViewKind::Command);
    assert_eq!(step.snapshot.guest.ui.owner_seat, Some(seat(GUEST_SEAT)));
    assert!(step.snapshot.guest.ui.actionable);
    assert_eq!(step.snapshot.guest.ui.cursor, Some(safe(1)));

    let repeat_timers = guest_human_input_schedules(step, safe(250));
    assert_eq!(repeat_timers.len(), 1);
    assert!(
        step.snapshot
            .guest
            .live_resources
            .timers
            .contains(&repeat_timers[0]),
        "directional hold repeat timer must remain live"
    );
    assert!(step.generated_effects.iter().all(|effect| {
        !matches!(
            effect,
            KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT)
        ) && !matches!(
            effect,
            KernelEffect::UiIntent {
                endpoint,
                intent: UiIntent::CommandSubmitted { .. },
            } if *endpoint == seat(GUEST_SEAT)
        )
    }));
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
    }
    assert_eq!(
        snapshot.host.live_resources,
        LiveResourceSnapshot::default()
    );
    assert_eq!(
        snapshot.guest.live_resources,
        LiveResourceSnapshot::default()
    );
    assert!(snapshot.clock_timers.is_empty());
    for endpoint in [&snapshot.host, &snapshot.guest] {
        assert!(endpoint.presenter.pending_event_ids.is_empty());
        assert!(endpoint.presenter.settled_event_ids.is_empty());
        assert!(endpoint.presenter.disposed);
    }
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

fn assert_post_disposal_rejected(pair: &mut SimulatedPair) -> TestResult {
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
    assert!(matches!(
        pair.teardown("m2-recovery-campaign repeated teardown"),
        Err(SimulatedPairError::Disposed)
    ));
    Ok(())
}

fn run_directional_repeat_probe() -> TestResult<(Vec<PairStep>, PairSnapshot)> {
    let mut pair = SimulatedPair::new(repeat_probe_config()?)?;
    let initial = pair.snapshot()?;
    assert_eq!(initial.guest.ui.kind, UiViewKind::Command);
    assert_eq!(initial.guest.ui.owner_seat, Some(seat(GUEST_SEAT)));
    assert!(initial.guest.ui.actionable);
    assert_eq!(initial.guest.ui.cursor, Some(SafeU53::ZERO));
    assert_eq!(
        initial
            .guest
            .ui
            .options
            .iter()
            .filter(|option| option.enabled && option.visible)
            .count(),
        3
    );

    let mut trace = Vec::new();
    let key_down = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowDown,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    assert_eq!(key_down.snapshot.guest.ui.cursor, Some(safe(1)));
    let initial_repeat_timers = guest_human_input_schedules(&key_down, safe(250));
    assert_eq!(initial_repeat_timers.len(), 1);
    let initial_repeat_timer = initial_repeat_timers[0];
    assert!(
        key_down
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&initial_repeat_timer)
    );
    trace.push(key_down);

    let repeat = pair.apply(PairOperation::AdvanceTime {
        delta_ms: safe(250),
    })?;
    assert_eq!(
        repeat.operation,
        PairOperation::AdvanceTime {
            delta_ms: safe(250),
        }
    );
    assert_eq!(repeat.snapshot.virtual_time_ms, safe(250));
    assert_eq!(repeat.snapshot.guest.ui.cursor, Some(safe(2)));
    let rearmed_repeat_timers = guest_human_input_schedules(&repeat, safe(250));
    assert_eq!(rearmed_repeat_timers.len(), 1);
    let rearmed_repeat_timer = rearmed_repeat_timers[0];
    assert_ne!(rearmed_repeat_timer, initial_repeat_timer);
    assert!(
        !repeat
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&initial_repeat_timer)
    );
    assert!(
        repeat
            .snapshot
            .guest
            .live_resources
            .timers
            .contains(&rearmed_repeat_timer)
    );
    trace.push(repeat);

    let key_up = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
    })?;
    assert_eq!(key_up.snapshot.guest.ui.cursor, Some(safe(2)));
    assert_eq!(
        guest_timer_cancellations(&key_up),
        vec![rearmed_repeat_timer]
    );
    assert!(key_up.snapshot.guest.live_resources.timers.is_empty());
    trace.push(key_up);

    let torn_down = pair.teardown("m2-directional-repeat-probe")?;
    assert_zero_resources(&torn_down);
    assert_post_disposal_rejected(&mut pair)?;
    Ok((trace, torn_down))
}

fn assert_fresh_guest_command(
    steps: &[PairStep],
    expected_generation: MenuGeneration,
) -> TestResult {
    let intents = steps
        .iter()
        .flat_map(|step| step.generated_effects.iter())
        .filter_map(|effect| match effect {
            KernelEffect::UiIntent { endpoint, intent } if *endpoint == seat(GUEST_SEAT) => {
                Some(intent)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        intents.len(),
        1,
        "fresh raw input must emit one guest intent"
    );
    match intents[0] {
        UiIntent::CommandSubmitted {
            seat: submitted_seat,
            generation,
            operation_id,
            control_id,
            option_id,
        } => {
            assert_eq!(submitted_seat, &seat(GUEST_SEAT));
            assert_eq!(generation, &expected_generation);
            assert_eq!(operation_id, &operation(4)?);
            assert_eq!(control_id, &control_id_of(&command_control(4, GUEST_SEAT)));
            let expected_option_id = option(4)?.id;
            assert_eq!(option_id, &expected_option_id);
        }
        intent => {
            return Err(std::io::Error::other(format!(
                "fresh raw input emitted the wrong typed intent: {intent:?}"
            ))
            .into());
        }
    }
    Ok(())
}

fn drain_queued_protocol_frames(
    pair: &mut SimulatedPair,
    trace: &mut Vec<PairStep>,
) -> TestResult<PairSnapshot> {
    for _ in 0..256 {
        let snapshot = pair.snapshot()?;
        if snapshot.network.queued_packet_ids.is_empty() {
            return Ok(snapshot);
        }
        trace.push(pair.apply(PairOperation::Fault {
            operation: FaultOperation::DeliverNext,
        })?);
    }
    Err(std::io::Error::other("queued protocol frames did not drain within 256 deliveries").into())
}

fn run_campaign() -> TestResult<(Vec<PairStep>, PairSnapshot)> {
    assert!(matches!(next_control(4), NextControl::CommandFrontier(_)));
    let mut pair = SimulatedPair::new(campaign_config()?)?;
    let mut trace = Vec::new();

    trace.extend(pair.press(PairEndpoint::Host, PhysicalKey::Enter)?);
    trace.push(pair.advance_time(safe(10))?);
    drop_queued_packets(&mut pair, &mut trace)?;

    let after_first_entry = trace
        .last()
        .ok_or_else(|| std::io::Error::other("first entry did not produce a campaign step"))?;
    assert_eq!(after_first_entry.snapshot.seed, SEED.to_string());
    assert_eq!(after_first_entry.snapshot.network.seed, SEED.to_string());
    assert_eq!(
        after_first_entry.snapshot.guest.ui.kind,
        UiViewKind::Command
    );
    assert_eq!(
        after_first_entry.snapshot.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    let stale_generation = after_first_entry.snapshot.guest.ui.generation;

    let pre_recovery_action_start = trace.len();
    let (retained_proposal, stale_packet_id) =
        hold_new_packets_after_guest_action(&mut pair, &mut trace)?;
    assert_proposal_identities(&trace[pre_recovery_action_start..], &[(2, generation(0))])?;

    let directional_hold_before = trace
        .last()
        .ok_or_else(|| std::io::Error::other("directional hold has no preceding step"))?
        .snapshot
        .clone();
    let directional_hold = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowDown,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    assert_eq!(
        directional_hold.operation,
        PairOperation::RawInput {
            endpoint: PairEndpoint::Guest,
            event: RawInputEvent::KeyDown {
                code: PhysicalKey::ArrowDown,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        }
    );
    assert_directional_hold_started(&directional_hold_before, &directional_hold)?;
    let directional_repeat_timer = guest_human_input_schedules(&directional_hold, safe(250))
        .first()
        .copied()
        .ok_or_else(|| std::io::Error::other("directional hold repeat timer was not scheduled"))?;
    trace.push(directional_hold);

    trace.extend(pair.press(PairEndpoint::Host, PhysicalKey::Enter)?);
    let disconnect_step = pair.apply(PairOperation::Disconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    assert_eq!(
        guest_timer_cancellations(&disconnect_step),
        vec![directional_repeat_timer],
        "disconnect must own the directional repeat timer cancellation exactly once"
    );
    trace.push(disconnect_step);
    let recovery_start = trace.len();
    let before_reconnect = trace
        .last()
        .ok_or_else(|| std::io::Error::other("reconnect has no preceding campaign step"))?
        .snapshot
        .clone();
    let reconnect_step = pair.apply(PairOperation::Reconnect {
        endpoint: PairEndpoint::Guest,
    })?;
    // Rebind republishes the retained tail before the RecoveryBundle.  One
    // tail control is host-owned, so it is intentionally a remote-only
    // projection on the guest; discard every rebind entry, rather than
    // treating that empty local surface as a recovered guest command.
    let mut rebound_tail_packets = Vec::<(SafeU53, AuthorityEntryBody)>::new();
    for (packet_id, effect) in send_effect_packets(&before_reconnect, &reconnect_step)? {
        let KernelEffect::SendFrame { from, frame } = effect else {
            continue;
        };
        if from != seat(HOST_SEAT) || frame.frame_type != FrameType::AuthorityEntry {
            continue;
        }
        assert_eq!(frame.context, context_at(HOST_SEAT, 1)?);
        rebound_tail_packets.push((packet_id, typed_frame_body(&frame)?));
    }
    assert_eq!(
        rebound_tail_packets.len(),
        2,
        "reconnect must retain exactly the dense authority tail for recovery"
    );
    assert_full_tail_entry(&rebound_tail_packets[0].1, 2)?;
    assert_full_tail_entry(&rebound_tail_packets[1].1, 3)?;
    trace.push(reconnect_step);
    for (packet_id, _) in rebound_tail_packets {
        let dropped = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Drop { packet_id },
        })?;
        assert!(
            !dropped
                .snapshot
                .network
                .queued_packet_ids
                .contains(&packet_id),
            "rebound authority tail must be discarded before recovery installs the frontier"
        );
        trace.push(dropped);
    }

    let reconnect_step = trace
        .get(recovery_start)
        .ok_or_else(|| std::io::Error::other("reconnect did not produce a campaign step"))?;
    assert_eq!(reconnect_step.snapshot.seed, SEED.to_string());
    assert_ne!(
        reconnect_step.snapshot.guest.ui.generation,
        stale_generation
    );
    assert_eq!(reconnect_step.snapshot.guest.ui.kind, UiViewKind::Waiting);
    assert!(!reconnect_step.snapshot.guest.ui.actionable);
    let reconnect_fence = guest_recovery_fence(reconnect_step)?;
    assert_held_recovery_fence(&reconnect_fence);
    assert!(
        !guest_timer_cancellations(reconnect_step).contains(&directional_repeat_timer),
        "reconnect must not cancel the already-cleared directional repeat timer"
    );
    assert!(has_frame(
        &reconnect_step.generated_effects,
        FrameType::RecoveryRequest
    ));

    let rebound_proposals = proposal_effects(std::slice::from_ref(reconnect_step));
    assert_eq!(
        rebound_proposals.len(),
        1,
        "reconnect must resend the retained guest proposal exactly once"
    );
    let rebound_proposal = rebound_proposals[0];
    assert_eq!(
        rebound_proposal.operation_id,
        retained_proposal.operation_id
    );
    assert_eq!(rebound_proposal.fingerprint, retained_proposal.fingerprint);
    assert_eq!(rebound_proposal.payload, retained_proposal.payload);
    assert_eq!(rebound_proposal.from, retained_proposal.from);
    assert_eq!(rebound_proposal.to, retained_proposal.to);
    assert_eq!(rebound_proposal.connection_generation, generation(1));
    assert_proposal_identities(std::slice::from_ref(reconnect_step), &[(2, generation(1))])?;

    let before_stale_delivery = pair.snapshot()?;
    assert_eq!(
        before_stale_delivery.network.dropped_count.get(),
        reconnect_step
            .snapshot
            .network
            .dropped_count
            .get()
            .saturating_add(2),
        "the two retained-tail drops must increment dropped_count exactly twice"
    );
    assert!(
        before_stale_delivery
            .network
            .queued_packet_ids
            .contains(&stale_packet_id),
        "the duplicated old-generation proposal must remain queued after tail drops"
    );
    let stale_delivery = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: stale_packet_id,
        },
    })?;
    assert!(stale_delivery.generated_effects.is_empty());
    assert_eq!(
        stale_delivery.snapshot.network.dropped_count.get(),
        before_stale_delivery
            .network
            .dropped_count
            .get()
            .saturating_add(1)
    );
    assert_eq!(
        stale_delivery.snapshot.host.kernel,
        before_stale_delivery.host.kernel
    );
    assert_eq!(
        stale_delivery.snapshot.guest.kernel,
        before_stale_delivery.guest.kernel
    );
    trace.push(stale_delivery);

    let before_fence_waiting_submit = trace
        .last()
        .ok_or_else(|| std::io::Error::other("recovery-fence submit has no preceding step"))?
        .snapshot
        .clone();
    let fence_waiting_step = trace
        .last()
        .ok_or_else(|| std::io::Error::other("recovery-fence step was not retained"))?;
    let fence_waiting_view = guest_recovery_fence(fence_waiting_step)?;
    assert_held_recovery_fence(&fence_waiting_view);
    let fence_waiting_submit = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    assert!(fence_waiting_submit.generated_effects.iter().all(|effect| {
        !matches!(
            effect,
            KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT)
        ) && !matches!(
            effect,
            KernelEffect::UiIntent { endpoint, .. } if *endpoint == seat(GUEST_SEAT)
        )
    }));
    assert_no_pair_progression(&before_fence_waiting_submit, &fence_waiting_submit.snapshot)?;
    trace.push(fence_waiting_submit);
    let fence_waiting_release = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
    })?;
    assert_no_pair_progression(
        &before_fence_waiting_submit,
        &fence_waiting_release.snapshot,
    )?;
    trace.push(fence_waiting_release);

    let mut delayed_recovery_evidence = Vec::<(SafeU53, FrameType)>::new();
    let mut delayed_control_receipt_packets = Vec::<SafeU53>::new();
    // Settle recovery one network tick at a time. Since enqueued packets have
    // at least one millisecond of latency, sends produced at this boundary
    // remain queued and retain exact packet ownership for evidence selection.
    for _ in 0..480 {
        let before_step = trace
            .last()
            .ok_or_else(|| std::io::Error::other("recovery step has no preceding snapshot"))?
            .snapshot
            .clone();
        let step = pair.advance_time(safe(1))?;
        let recovery_released = step
            .snapshot
            .guest
            .live_resources
            .recovery_transactions
            .is_empty()
            && has_frame(&step.generated_effects, FrameType::RecoveryApplied);
        let evidence = if recovery_released {
            let send_packets = send_effect_packets(&before_step, &step)?;
            delayed_control_receipt_packets = send_packets
                .iter()
                .filter_map(|(packet_id, effect)| {
                    is_control_installed_receipt(effect).then_some(*packet_id)
                })
                .collect();
            send_packets
                .into_iter()
                .filter_map(|(packet_id, effect)| match effect {
                    KernelEffect::SendFrame { from, frame }
                        if from == seat(GUEST_SEAT)
                            && matches!(
                                frame.frame_type,
                                FrameType::AuthorityReceipt | FrameType::RecoveryApplied
                            ) =>
                    {
                        Some((packet_id, frame.frame_type))
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        trace.push(step);
        if recovery_released {
            assert!(
                evidence
                    .iter()
                    .any(|(_, frame_type)| *frame_type == FrameType::AuthorityReceipt),
                "recovery must emit the prior revision's control-installed receipt"
            );
            assert!(
                evidence
                    .iter()
                    .any(|(_, frame_type)| *frame_type == FrameType::RecoveryApplied),
                "recovery must emit the prior revision's applied proof"
            );
            delayed_recovery_evidence = evidence;
            for (packet_id, _) in delayed_recovery_evidence.iter().copied() {
                let delayed = pair.apply(PairOperation::Fault {
                    operation: FaultOperation::Delay {
                        packet_id,
                        additional_ms: safe(1_000),
                    },
                })?;
                assert!(
                    delayed
                        .snapshot
                        .network
                        .queued_packet_ids
                        .contains(&packet_id),
                    "delayed recovery evidence must remain queued"
                );
                trace.push(delayed);
            }
            break;
        }
    }
    assert!(
        !delayed_recovery_evidence.is_empty(),
        "recovery did not produce delayable control-installed evidence"
    );
    assert_eq!(
        delayed_control_receipt_packets.len(),
        1,
        "recovery must delay exactly one control-installed receipt"
    );
    assert!(delayed_control_receipt_packets.iter().all(|packet_id| {
        delayed_recovery_evidence
            .iter()
            .any(|(delayed_id, _)| delayed_id == packet_id)
    }));

    let recovery_trace = &trace[recovery_start..];
    let recovery_effects = effects(recovery_trace);
    let request_frames = frame_effects(&recovery_effects, FrameType::RecoveryRequest);
    assert_eq!(request_frames.len(), 1);
    let (request_from, request_frame) = request_frames[0];
    assert_eq!(request_from, seat(GUEST_SEAT));
    assert_eq!(request_frame.context, context_at(GUEST_SEAT, 1)?);
    assert_eq!(request_frame.context.sender_seat_id, seat(GUEST_SEAT));
    assert_eq!(request_frame.context.connection_generation, generation(1));
    let request: RecoveryRequestBody = typed_frame_body(request_frame)?;
    assert!(!request.request_id.is_empty());
    assert_eq!(request.captured_frontier, revision(1));
    assert_eq!(request.reason, "transport-reconnect");

    let bundle_frames = frame_effects(&recovery_effects, FrameType::RecoveryBundle);
    assert_eq!(bundle_frames.len(), 1);
    let (bundle_from, bundle_frame) = bundle_frames[0];
    assert_eq!(bundle_from, seat(HOST_SEAT));
    assert_eq!(bundle_frame.context, context_at(HOST_SEAT, 1)?);
    assert_eq!(bundle_frame.context.sender_seat_id, seat(HOST_SEAT));
    assert_eq!(bundle_frame.context.connection_generation, generation(1));
    let bundle: RecoveryBundleBody = typed_frame_body(bundle_frame)?;
    assert_eq!(bundle.request_id, request.request_id);
    assert_eq!(bundle.material, material(3));
    assert_eq!(bundle.frontier, revision(3));
    assert_eq!(bundle.frontier_operation_id, Some(operation(3)?));
    assert_eq!(bundle.membership_revision, MembershipRevision::new(safe(1)));
    assert_eq!(bundle.next_control, Some(next_control(3)));
    let tail = &bundle.required_tail;
    assert_eq!(tail.len(), 2);
    assert_full_tail_entry(&tail[0], 2)?;
    assert_full_tail_entry(&tail[1], 3)?;
    let final_entry = tail[1].clone().with_context(bundle_frame.context.clone());
    let expected_final_entry = expected_tail_entry(3)?.with_context(bundle_frame.context.clone());
    assert_eq!(final_entry, expected_final_entry);
    assert_eq!(final_entry.context, context_at(HOST_SEAT, 1)?);
    assert_eq!(tail[1].revision, revision(3));
    assert_eq!(tail[1].operation_id, operation(3)?);
    assert_eq!(tail[1].material.digest, material(3).digest);
    assert_eq!(tail[1].next_control, next_control(3));

    let material_effects = recovery_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint,
                revision,
                operation_id,
                material,
            } if *endpoint == seat(GUEST_SEAT) => {
                Some((*endpoint, *revision, operation_id.clone(), material.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(material_effects.len(), 1);
    let (material_endpoint, material_revision, material_operation, applied_material) =
        &material_effects[0];
    assert_eq!(material_endpoint, &seat(GUEST_SEAT));
    assert_eq!(material_revision, &revision(3));
    assert_eq!(material_operation, &operation(3)?);
    assert_eq!(applied_material, &material(3));

    let control_effects = recovery_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision,
                operation_id,
                control,
            } if *endpoint == seat(GUEST_SEAT) => {
                Some((*endpoint, *revision, operation_id.clone(), control.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(control_effects.len(), 1);
    let (control_endpoint, control_revision, control_operation, projected_control) =
        &control_effects[0];
    let expected_control_id = control_id_of(&next_control(3));
    assert_eq!(control_endpoint, &seat(GUEST_SEAT));
    assert_eq!(control_revision, &revision(3));
    assert_eq!(control_operation, &operation(3)?);
    assert_eq!(projected_control, &next_control(3));
    assert_eq!(control_id_of(projected_control), expected_control_id);

    let applied_frames = frame_effects(&recovery_effects, FrameType::RecoveryApplied);
    assert_eq!(applied_frames.len(), 1);
    let (applied_from, applied_frame) = applied_frames[0];
    assert_eq!(applied_from, seat(GUEST_SEAT));
    assert_eq!(applied_frame.context, context_at(GUEST_SEAT, 1)?);
    assert_eq!(applied_frame.context.sender_seat_id, seat(GUEST_SEAT));
    assert_eq!(applied_frame.context.connection_generation, generation(1));
    let proof: RecoveryAppliedProof = typed_frame_body(applied_frame)?;
    assert_eq!(proof.request_id, request.request_id);
    assert_eq!(proof.frontier, revision(3));
    assert_eq!(proof.material_digest, material(3).digest);
    assert_eq!(proof.control_id, Some(expected_control_id.clone()));

    let material_index = recovery_effects
        .iter()
        .position(|effect| matches!(effect, KernelEffect::ApplyAuthorityMaterial { .. }))
        .ok_or_else(|| std::io::Error::other("material effect was not emitted"))?;
    let control_index = recovery_effects
        .iter()
        .position(|effect| matches!(effect, KernelEffect::ProjectAuthorityControl { .. }))
        .ok_or_else(|| std::io::Error::other("control effect was not emitted"))?;
    let applied_index = recovery_effects
        .iter()
        .position(|effect| {
            matches!(
                effect,
                KernelEffect::SendFrame { frame, .. }
                    if frame.frame_type == FrameType::RecoveryApplied
            )
        })
        .ok_or_else(|| std::io::Error::other("recovery proof effect was not emitted"))?;
    let control_receipt_index = recovery_effects
        .iter()
        .position(is_control_installed_receipt)
        .ok_or_else(|| std::io::Error::other("control-installed receipt effect was not emitted"))?;
    assert!(
        material_index < control_index
            && control_index < control_receipt_index
            && control_receipt_index < applied_index,
        "recovery must apply material, project control, send the control receipt, \
         then send the applied proof"
    );
    assert!(
        recovery_effects[..control_index].iter().all(|effect| {
            !matches!(
                effect,
                KernelEffect::SendProposal { proposal }
                    if proposal.from == seat(GUEST_SEAT)
                        && proposal.connection_generation != generation(1)
            ) && !matches!(
                effect,
                KernelEffect::UiIntent {
                    endpoint,
                    intent: UiIntent::CommandSubmitted { .. },
                } if *endpoint == seat(GUEST_SEAT)
            )
        }),
        "N+1 must remain blocked while the recovered control is pending"
    );

    let request_step_index = recovery_trace
        .iter()
        .position(|step| has_frame(&step.generated_effects, FrameType::RecoveryRequest))
        .ok_or_else(|| std::io::Error::other("recovery request step was not retained"))?;
    // `recovery_seeded_bundles_and_fences_fail_closed_with_ordered_phases` in
    // er-protocol/tests/authority_v2_properties.rs proves FenceChanged is
    // action 0 and SendRequest is action 2 of the same start batch. The pair
    // snapshot therefore checks the exact request step, not an invented prior
    // external step.
    let request_fence = guest_recovery_fence(&recovery_trace[request_step_index])?;
    assert_held_recovery_fence(&request_fence);
    assert!(
        recovery_trace
            .iter()
            .all(|step| !has_guest_stale_effect(&step.generated_effects, generation(1))),
        "the held pre-recovery input must not emit a guest intent or an old-generation proposal"
    );

    let applied_step_index = recovery_trace
        .iter()
        .position(|step| {
            step.generated_effects.iter().any(|effect| {
                matches!(
                    effect,
                    KernelEffect::SendFrame { frame, .. }
                        if frame.frame_type == FrameType::RecoveryApplied
                )
            })
        })
        .ok_or_else(|| {
            std::io::Error::other("recovery proof step was not retained in the trace")
        })?;
    for step in &recovery_trace[..applied_step_index] {
        let fence = guest_recovery_fence(step)?;
        assert_held_recovery_fence(&fence);
    }

    let mut first_released_step = None;
    for (index, step) in recovery_trace.iter().enumerate() {
        if guest_recovery_fence(step)?.state == RecoveryFenceState::Open {
            first_released_step = Some(index);
            break;
        }
    }
    let first_released_step = first_released_step
        .ok_or_else(|| std::io::Error::other("recovery fence was never released"))?;
    assert!(
        first_released_step >= applied_step_index,
        "recovery fence released before the applied proof"
    );
    let first_open_step = recovery_trace
        .iter()
        .position(|step| step.snapshot.guest.ui.actionable)
        .ok_or_else(|| std::io::Error::other("recovered command surface was never opened"))?;
    assert!(
        first_open_step >= applied_step_index,
        "recovered command surface opened before the applied proof"
    );
    let mut recovered_command_after_proof = false;
    for step in &recovery_trace[applied_step_index..] {
        let fence = guest_recovery_fence(step)?;
        if fence.state == RecoveryFenceState::Open
            && step.snapshot.guest.ui.kind == UiViewKind::Command
            && step.snapshot.guest.ui.actionable
        {
            recovered_command_after_proof = true;
            break;
        }
    }
    assert!(
        recovered_command_after_proof,
        "recovery fence release must expose the recovered command only after proof"
    );

    let final_step = trace
        .last()
        .ok_or_else(|| std::io::Error::other("recovery trace did not produce a final step"))?;
    assert_eq!(final_step.snapshot.guest.ui.kind, UiViewKind::Command);
    assert_eq!(
        final_step.snapshot.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    assert!(final_step.snapshot.guest.ui.actionable);
    assert_ne!(final_step.snapshot.guest.ui.generation, stale_generation);
    let final_fence = guest_recovery_fence(final_step)?;
    assert_open_recovery_fence(&final_fence);
    assert!(
        final_step
            .snapshot
            .guest
            .live_resources
            .controls
            .contains(&control_id_of(&command_control(4, GUEST_SEAT)))
    );

    let fresh_menu_generation = final_step.snapshot.guest.ui.generation;
    for (packet_id, _) in delayed_recovery_evidence.iter() {
        assert!(
            final_step
                .snapshot
                .network
                .queued_packet_ids
                .contains(packet_id),
            "prior control evidence must remain delayed after the fresh menu opens"
        );
    }

    let stale_hold_before = final_step.snapshot.clone();
    let stale_hold_release = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
    })?;
    assert_eq!(
        stale_hold_release.snapshot.guest.ui, stale_hold_before.guest.ui,
        "the fenced stale release must not move the fresh cursor or submit the fresh menu"
    );
    assert_eq!(
        stale_hold_release.snapshot.guest.kernel.ui, stale_hold_before.guest.kernel.ui,
        "the fenced stale release must not mutate the fresh successor surface"
    );
    assert!(
        !has_guest_stale_effect(&stale_hold_release.generated_effects, generation(1)),
        "the fenced stale release must not emit a guest intent or old-generation proposal"
    );
    assert!(stale_hold_release.generated_effects.iter().all(|effect| {
        !matches!(
            effect,
            KernelEffect::UiChanged { endpoint, .. } if *endpoint == seat(GUEST_SEAT)
        ) && !matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial { endpoint, .. }
                if *endpoint == seat(GUEST_SEAT)
        ) && !matches!(
            effect,
            KernelEffect::ProjectAuthorityControl { endpoint, .. }
                if *endpoint == seat(GUEST_SEAT)
        )
    }));
    trace.push(stale_hold_release);

    let before_control_pending_submit = trace
        .last()
        .ok_or_else(|| std::io::Error::other("control-pending submit has no preceding step"))?
        .snapshot
        .clone();
    assert_eq!(
        before_control_pending_submit.guest.ui.kind,
        UiViewKind::Command
    );
    assert_eq!(
        before_control_pending_submit.guest.ui.owner_seat,
        Some(seat(GUEST_SEAT))
    );
    assert!(before_control_pending_submit.guest.ui.actionable);
    assert!(
        before_control_pending_submit
            .guest
            .ui
            .options
            .iter()
            .filter(|option| option.enabled && option.visible)
            .count()
            >= 2,
        "control-pending submit must target the recovered actionable menu"
    );
    let control_pending_submit = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    assert_fresh_guest_command(
        std::slice::from_ref(&control_pending_submit),
        fresh_menu_generation,
    )?;
    assert_proposal_identities(
        std::slice::from_ref(&control_pending_submit),
        &[(4, generation(1))],
    )?;
    let pending_packets =
        send_effect_packets(&before_control_pending_submit, &control_pending_submit)?;
    let pending_proposals = pending_packets
        .iter()
        .filter_map(|(packet_id, effect)| match effect {
            KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT) => {
                Some((*packet_id, proposal.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        pending_proposals.len(),
        1,
        "fresh N+1 Submit must queue exactly one retained proposal"
    );
    let (pending_proposal_packet_id, retained_next_proposal) = pending_proposals[0].clone();
    assert_eq!(retained_next_proposal.connection_generation, generation(1));
    trace.push(control_pending_submit);
    let control_pending_release = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
    })?;
    trace.push(control_pending_release);

    let before_pending_drop = trace
        .last()
        .ok_or_else(|| std::io::Error::other("pending proposal release was not retained"))?
        .snapshot
        .clone();
    for (packet_id, _) in delayed_recovery_evidence.iter() {
        assert!(
            before_pending_drop
                .network
                .queued_packet_ids
                .contains(packet_id),
            "delayed control evidence must remain queued while retained N+1 is withheld"
        );
    }
    let pending_drop = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Drop {
            packet_id: pending_proposal_packet_id,
        },
    })?;
    let mut expected_pending_drop_queue = before_pending_drop.network.queued_packet_ids.clone();
    assert!(expected_pending_drop_queue.remove(&pending_proposal_packet_id));
    assert_eq!(
        pending_drop.snapshot.network.queued_packet_ids, expected_pending_drop_queue,
        "dropping retained N+1 must remove only its packet and preserve delayed control evidence"
    );
    for (packet_id, _) in delayed_recovery_evidence.iter() {
        assert!(
            pending_drop
                .snapshot
                .network
                .queued_packet_ids
                .contains(packet_id),
            "retained N+1 must be withheld/lost while delayed control evidence remains queued"
        );
    }
    assert_no_protocol_progression(&before_pending_drop, &pending_drop.snapshot)?;
    assert!(pending_drop.generated_effects.is_empty());
    trace.push(pending_drop);

    for (packet_id, frame_type) in delayed_recovery_evidence.iter().copied() {
        let before_evidence_delivery = trace
            .last()
            .ok_or_else(|| std::io::Error::other("evidence delivery has no preceding step"))?
            .snapshot
            .clone();
        assert!(
            before_evidence_delivery
                .network
                .queued_packet_ids
                .contains(&packet_id),
            "the exact delayed recovery evidence packet must be deliverable"
        );
        let evidence_delivery = pair.apply(PairOperation::Fault {
            operation: FaultOperation::Deliver { packet_id },
        })?;
        assert_eq!(
            evidence_delivery.operation,
            PairOperation::Fault {
                operation: FaultOperation::Deliver { packet_id },
            }
        );
        assert!(
            !evidence_delivery
                .snapshot
                .network
                .queued_packet_ids
                .contains(&packet_id),
            "delivered {frame_type:?} evidence must leave the network queue"
        );
        trace.push(evidence_delivery);
    }
    let after_recovery_evidence = trace
        .last()
        .ok_or_else(|| std::io::Error::other("recovery evidence was not retained"))?
        .snapshot
        .clone();
    for (packet_id, _) in delayed_recovery_evidence.iter() {
        assert!(
            !after_recovery_evidence
                .network
                .queued_packet_ids
                .contains(packet_id),
            "all delayed recovery evidence must be delivered before retry"
        );
    }

    let before_retry_submit = after_recovery_evidence.clone();
    let retry_submit = pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    })?;
    assert_fresh_guest_command(std::slice::from_ref(&retry_submit), fresh_menu_generation)?;
    assert_proposal_identities(std::slice::from_ref(&retry_submit), &[(4, generation(1))])?;
    let retry_packets = send_effect_packets(&before_retry_submit, &retry_submit)?;
    let retry_proposals = retry_packets
        .iter()
        .filter_map(|(packet_id, effect)| match effect {
            KernelEffect::SendProposal { proposal } if proposal.from == seat(GUEST_SEAT) => {
                Some((*packet_id, proposal.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        retry_proposals.len(),
        1,
        "the retained N+1 proposal must retry exactly once after evidence"
    );
    let (retry_packet_id, retry_proposal) = retry_proposals[0].clone();
    assert_eq!(retry_proposal, retained_next_proposal);
    trace.push(retry_submit);
    trace.push(pair.apply(PairOperation::RawInput {
        endpoint: PairEndpoint::Guest,
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
    })?);

    let before_retry_duplicate = trace
        .last()
        .ok_or_else(|| std::io::Error::other("retry release was not retained"))?
        .snapshot
        .clone();
    let retry_duplicate = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Duplicate {
            packet_id: retry_packet_id,
        },
    })?;
    assert!(retry_duplicate.generated_effects.is_empty());
    let duplicate_packet_ids = retry_duplicate
        .snapshot
        .network
        .queued_packet_ids
        .difference(&before_retry_duplicate.network.queued_packet_ids)
        .copied()
        .collect::<Vec<_>>();
    assert_eq!(duplicate_packet_ids.len(), 1);
    let duplicate_retry_packet_id = duplicate_packet_ids[0];
    trace.push(retry_duplicate);

    let before_retry_delivery = trace
        .last()
        .ok_or_else(|| std::io::Error::other("retry duplicate was not retained"))?
        .snapshot
        .clone();
    let retry_delivery = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: retry_packet_id,
        },
    })?;
    assert_ne!(
        retry_delivery.snapshot.host.kernel, before_retry_delivery.host.kernel,
        "the retained N+1 identity must execute only after delayed evidence"
    );
    let before_duplicate_delivery = retry_delivery.snapshot.clone();
    let duplicate_delivery = pair.apply(PairOperation::Fault {
        operation: FaultOperation::Deliver {
            packet_id: duplicate_retry_packet_id,
        },
    })?;
    assert_duplicate_delivery_is_idempotent(
        &before_duplicate_delivery,
        &duplicate_delivery,
        duplicate_retry_packet_id,
    )?;

    let retry_attempt_steps = [retry_delivery.clone(), duplicate_delivery.clone()];
    let retry_attempt_effects = effects(&retry_attempt_steps);
    let retry_material_effects = retry_attempt_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ApplyAuthorityMaterial {
                endpoint,
                revision,
                operation_id,
                material,
            } if *endpoint == seat(HOST_SEAT) => {
                Some((*revision, operation_id.clone(), material.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(retry_material_effects.len(), 1);
    assert_eq!(retry_material_effects[0].0, revision(4));
    assert_eq!(retry_material_effects[0].1, operation(4)?);
    assert_eq!(retry_material_effects[0].2, material(4));
    let retry_control_effects = retry_attempt_effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ProjectAuthorityControl {
                endpoint,
                revision,
                operation_id,
                control,
            } if *endpoint == seat(HOST_SEAT) => {
                Some((*revision, operation_id.clone(), control.clone()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(retry_control_effects.len(), 1);
    assert_eq!(retry_control_effects[0].0, revision(4));
    assert_eq!(retry_control_effects[0].1, operation(4)?);
    assert_eq!(retry_control_effects[0].2, next_control(4));
    let retry_entry_frames = frame_effects(&retry_attempt_effects, FrameType::AuthorityEntry);
    assert_eq!(retry_entry_frames.len(), 1);
    assert_eq!(retry_entry_frames[0].0, seat(HOST_SEAT));
    let retry_entry: AuthorityEntryBody = typed_frame_body(retry_entry_frames[0].1)?;
    assert_full_tail_entry(&retry_entry, 4)?;
    trace.extend(retry_attempt_steps);

    let before_teardown = drain_queued_protocol_frames(&mut pair, &mut trace)?;
    let host_head: Revision = typed_json_path(
        &before_teardown.host.kernel.state,
        &["protocol", "log", "headRevision"],
    )?;
    assert_eq!(host_head, revision(4));
    let guest_received: Revision = typed_json_path(
        &before_teardown.guest.kernel.state,
        &["protocol", "replica", "frontier", "received"],
    )?;
    let guest_material: Revision = typed_json_path(
        &before_teardown.guest.kernel.state,
        &["protocol", "replica", "frontier", "material"],
    )?;
    let guest_control: Revision = typed_json_path(
        &before_teardown.guest.kernel.state,
        &["protocol", "replica", "frontier", "control"],
    )?;
    assert_eq!(
        (guest_received, guest_material, guest_control),
        (revision(4), revision(4), revision(4))
    );
    assert_eq!(before_teardown.terminal_reason, None);
    assert!(
        before_teardown
            .guest
            .live_resources
            .proposal_leases
            .contains(&operation(4)?),
        "TurnCommit proposal lease must remain retained until explicit teardown"
    );
    assert!(
        !before_teardown.guest.live_resources.timers.is_empty(),
        "retained TurnCommit proposal must keep its retry/absolute timers live"
    );
    assert!(before_teardown.network.queued_packet_ids.is_empty());
    assert!(!before_teardown.storage.keys.is_empty());
    let torn_down = pair.teardown("m2-recovery-campaign")?;
    assert_eq!(torn_down.seed, SEED.to_string());
    assert_eq!(torn_down.network.seed, SEED.to_string());
    assert_zero_resources(&torn_down);
    assert_post_disposal_rejected(&mut pair)?;
    Ok((trace, torn_down))
}

#[test]
fn recovery_campaign_fences_dense_tail_and_rejoins_on_physical_input() -> TestResult {
    let first = run_campaign()?;
    let second = run_campaign()?;
    assert_eq!(first, second, "recovery campaign must repeat byte-for-byte");
    assert_eq!(serde_json::to_vec(&first)?, serde_json::to_vec(&second)?);
    assert!(first.0.iter().all(|step| !step.effects_digest.is_empty()));
    Ok(())
}

#[test]
fn raw_directional_repeat_rearms_and_cancels_on_three_option_menu() -> TestResult {
    let first = run_directional_repeat_probe()?;
    let second = run_directional_repeat_probe()?;
    assert_eq!(first, second, "repeat probe must repeat byte-for-byte");
    assert_eq!(serde_json::to_vec(&first)?, serde_json::to_vec(&second)?);
    Ok(())
}
